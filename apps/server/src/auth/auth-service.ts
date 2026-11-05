import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import type pg from 'pg';
import { ProblemError } from '../problem.js';

export interface AuthConfig {
  /** Llega por Key Vault en Azure y por entorno en local; nunca está en el repositorio. */
  readonly jwtSecret: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export interface Principal {
  readonly userId: string;
  readonly role: 'player' | 'admin';
}

export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'player' | 'admin';
  readonly balance: number;
}

const ISSUER = 'ashenfall';
const AUDIENCE = 'ashenfall-api';
const UNIQUE_VIOLATION = '23505';

const invalidCredentials = (): ProblemError =>
  new ProblemError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
const invalidRefresh = (): ProblemError => new ProblemError(401, 'INVALID_REFRESH_TOKEN', 'Sesión inválida o vencida');
const invalidToken = (): ProblemError => new ProblemError(401, 'INVALID_TOKEN', 'Token ausente, inválido o vencido');
const suspended = (): ProblemError => new ProblemError(403, 'USER_SUSPENDED', 'Usuario suspendido');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private readonly secret: Uint8Array;
  /** Se verifica cuando el correo no existe, para que el tiempo de respuesta no revele qué cuentas hay. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: AuthConfig,
  ) {
    this.secret = new TextEncoder().encode(config.jwtSecret);
    this.dummyHash = argon2.hash(randomUUID(), { type: argon2.argon2id });
  }

  async register(email: string, password: string, displayName: string): Promise<TokenPair> {
    const id = randomUUID();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)', [
        id,
        email,
        displayName,
        passwordHash,
      ]);
      await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'code' in error && error.code === UNIQUE_VIOLATION) {
        throw new ProblemError(409, 'EMAIL_TAKEN', 'Ese correo ya está registrado');
      }
      throw error;
    } finally {
      client.release();
    }
    return this.issue({ userId: id, role: 'player' }, randomUUID());
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const { rows } = await this.pool.query<{
      id: string;
      password_hash: string;
      role: Principal['role'];
      suspended_at: Date | null;
    }>('SELECT id, password_hash, role, suspended_at FROM users WHERE lower(email) = lower($1)', [email]);
    const user = rows[0];
    if (user === undefined) {
      await argon2.verify(await this.dummyHash, password);
      throw invalidCredentials();
    }
    if (!(await argon2.verify(user.password_hash, password))) throw invalidCredentials();
    if (user.suspended_at !== null) throw suspended();
    return this.issue({ userId: user.id, role: user.role }, randomUUID());
  }

  /**
   * Rotación atómica: el UPDATE solo gana una vez aunque lleguen dos peticiones a la vez.
   * Reutilizar un token ya rotado indica posible robo, así que se revoca toda su familia.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const { rows } = await this.pool.query<{ user_id: string; family_id: string }>(
      `UPDATE refresh_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id, family_id`,
      [tokenHash],
    );
    const current = rows[0];
    if (current === undefined) {
      await this.pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE revoked_at IS NULL
           AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1 AND used_at IS NOT NULL)`,
        [tokenHash],
      );
      throw invalidRefresh();
    }
    const principal = await this.principalOf(current.user_id);
    return this.issue(principal, current.family_id);
  }

  /** Idempotente: cerrar una sesión ya cerrada o desconocida no revela nada. */
  async logout(refreshToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL
         AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [hashToken(refreshToken)],
    );
  }

  /** Valida el token y consulta el usuario: una suspensión surte efecto de inmediato, sin esperar a que venza. */
  async authenticate(authorization: string | undefined): Promise<Principal> {
    const token = authorization?.startsWith('Bearer ') === true ? authorization.slice('Bearer '.length) : null;
    if (token === null) throw invalidToken();
    const userId = await this.subjectOf(token);
    if (userId === null) throw invalidToken();
    return this.principalOf(userId);
  }

  /** Usuario de un token con firma válida, sin consultar la base. Solo para contar límites de tasa. */
  verifiedSubject(authorization: string | undefined): Promise<string | null> {
    if (authorization?.startsWith('Bearer ') !== true) return Promise.resolve(null);
    return this.subjectOf(authorization.slice('Bearer '.length));
  }

  private async subjectOf(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  async profile(userId: string): Promise<Profile> {
    const { rows } = await this.pool.query<{
      id: string;
      email: string;
      display_name: string;
      role: Principal['role'];
      balance: number;
    }>(
      `SELECT u.id, u.email, u.display_name, u.role, w.balance
       FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    const row = rows[0];
    if (row === undefined) throw invalidToken();
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, balance: row.balance };
  }

  private async principalOf(userId: string): Promise<Principal> {
    const { rows } = await this.pool.query<{ role: Principal['role']; suspended_at: Date | null }>(
      'SELECT role, suspended_at FROM users WHERE id = $1',
      [userId],
    );
    const user = rows[0];
    if (user === undefined) throw invalidToken();
    if (user.suspended_at !== null) throw suspended();
    return { userId, role: user.role };
  }

  private async issue(principal: Principal, familyId: string): Promise<TokenPair> {
    const accessToken = await new SignJWT({ role: principal.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(principal.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenTtlSeconds}s`)
      .sign(this.secret);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.pool.query(
      `INSERT INTO refresh_tokens (token_hash, user_id, family_id, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [hashToken(refreshToken), principal.userId, familyId, this.config.refreshTokenTtlSeconds],
    );
    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTtlSeconds };
  }
}
