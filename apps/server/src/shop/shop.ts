import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AuthService } from '../auth/auth-service.js';
import { inTransaction } from '../db/transaction.js';
import { ProblemError } from '../problem.js';

const CosmeticId = Type.String({ pattern: '^[a-z0-9-]{1,64}$' });
// El cliente no envía precio: solo qué quiere y un id para reintentar sin pagar dos veces.
const Purchase = Type.Object({ cosmeticId: CosmeticId, purchaseId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
const EquipParams = Type.Object({ cosmeticId: CosmeticId });
const Equip = Type.Object({ equipped: Type.Boolean() }, { additionalProperties: false });

export interface PurchaseResult {
  readonly cosmeticId: string;
  readonly balance: number;
  readonly duplicate: boolean;
}

export class ShopService {
  constructor(private readonly pool: pg.Pool) {}

  async purchase(userId: string, cosmeticId: string, purchaseId: string): Promise<PurchaseResult> {
    return inTransaction(this.pool, async (client) => {
      // Bloquear la billetera serializa las compras de un mismo usuario.
      const wallet = await client.query<{ balance: number }>('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const balance = wallet.rows[0]?.balance;
      if (balance === undefined) throw new ProblemError(404, 'WALLET_NOT_FOUND', 'El usuario no tiene billetera');

      const key = `purchase:${userId}:${purchaseId}`;
      const previous = await client.query<{ amount: number }>('SELECT amount FROM wallet_transactions WHERE idempotency_key = $1', [key]);
      if ((previous.rowCount ?? 0) > 0) return { cosmeticId, balance, duplicate: true };

      const item = await client.query<{ price: number }>('SELECT price FROM cosmetic_catalog WHERE id = $1', [cosmeticId]);
      const price = item.rows[0]?.price;
      if (price === undefined) throw new ProblemError(404, 'COSMETIC_NOT_FOUND', 'El artículo no existe');

      const owned = await client.query('SELECT 1 FROM player_cosmetics WHERE user_id = $1 AND cosmetic_id = $2', [userId, cosmeticId]);
      if ((owned.rowCount ?? 0) > 0) throw new ProblemError(409, 'ALREADY_OWNED', 'Ya tienes este artículo');
      if (balance < price) throw new ProblemError(409, 'INSUFFICIENT_FUNDS', 'No tienes suficientes Marcas de Ceniza');

      await client.query(
        `INSERT INTO wallet_transactions (id, user_id, amount, kind, idempotency_key) VALUES ($1, $2, $3, 'purchase', $4)`,
        [randomUUID(), userId, -price, key],
      );
      await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [price, userId]);
      await client.query('INSERT INTO player_cosmetics (user_id, cosmetic_id) VALUES ($1, $2)', [userId, cosmeticId]);
      return { cosmeticId, balance: balance - price, duplicate: false };
    });
  }

  /** Solo un artículo equipado por tipo. */
  async setEquipped(userId: string, cosmeticId: string, equipped: boolean): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const owned = await client.query<{ kind: string }>(
        `SELECT c.kind FROM player_cosmetics p JOIN cosmetic_catalog c ON c.id = p.cosmetic_id
         WHERE p.user_id = $1 AND p.cosmetic_id = $2 FOR UPDATE OF p`,
        [userId, cosmeticId],
      );
      const kind = owned.rows[0]?.kind;
      if (kind === undefined) throw new ProblemError(404, 'COSMETIC_NOT_OWNED', 'No tienes este artículo');
      if (equipped) {
        await client.query(
          `UPDATE player_cosmetics p SET equipped = false FROM cosmetic_catalog c
           WHERE c.id = p.cosmetic_id AND p.user_id = $1 AND c.kind = $2`,
          [userId, kind],
        );
      }
      await client.query('UPDATE player_cosmetics SET equipped = $1 WHERE user_id = $2 AND cosmetic_id = $3', [equipped, userId, cosmeticId]);
    });
  }
}

export function registerShopRoutes(app: FastifyInstance, auth: AuthService, pool: pg.Pool): void {
  const shop = new ShopService(pool);

  app.get('/v1/shop/catalog', async (request) => {
    await auth.authenticate(request.headers.authorization);
    const { rows } = await pool.query('SELECT id, name, kind, price FROM cosmetic_catalog ORDER BY price, id');
    return { items: rows };
  });

  app.post<{ Body: Static<typeof Purchase> }>('/v1/shop/purchases', { schema: { body: Purchase } }, async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    return shop.purchase(userId, request.body.cosmeticId, request.body.purchaseId);
  });

  app.get('/v1/me/inventory', async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    const { rows } = await pool.query<{ id: string; name: string; kind: string; equipped: boolean }>(
      `SELECT c.id, c.name, c.kind, p.equipped FROM player_cosmetics p JOIN cosmetic_catalog c ON c.id = p.cosmetic_id
       WHERE p.user_id = $1 ORDER BY c.id`,
      [userId],
    );
    return { items: rows };
  });

  app.post<{ Params: Static<typeof EquipParams>; Body: Static<typeof Equip> }>(
    '/v1/me/inventory/:cosmeticId/equip',
    { schema: { params: EquipParams, body: Equip } },
    async (request, reply) => {
      const { userId } = await auth.authenticate(request.headers.authorization);
      await shop.setEquipped(userId, request.params.cosmeticId, request.body.equipped);
      return reply.code(204).send();
    },
  );
}
