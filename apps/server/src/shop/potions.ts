import { randomUUID } from 'node:crypto';
import { isPotionId, POTION_IDS, POTION_LOADOUT_MAX, POTIONS, type PotionId } from '@ashenfall/domain';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AuthService } from '../auth/auth-service.js';
import { inTransaction } from '../db/transaction.js';
import { ProblemError } from '../problem.js';

const PotionIdSchema = Type.Union(POTION_IDS.map((id) => Type.Literal(id)));
const BuyPotion = Type.Object({ potionId: PotionIdSchema, purchaseId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
const SetLoadout = Type.Object({ potions: Type.Array(PotionIdSchema, { maxItems: POTION_LOADOUT_MAX }) }, { additionalProperties: false });

export interface PotionInventory {
  readonly items: readonly { id: PotionId; name: string; description: string; price: number; quantity: number }[];
  readonly loadout: readonly PotionId[];
  readonly loadoutMax: number;
}

export class PotionService {
  constructor(private readonly pool: pg.Pool) {}

  async inventory(userId: string): Promise<PotionInventory> {
    const [owned, loadout] = await Promise.all([
      this.pool.query<{ potion_id: string; quantity: number }>('SELECT potion_id, quantity FROM player_potions WHERE user_id = $1', [userId]),
      this.pool.query<{ potion_loadout: unknown }>('SELECT potion_loadout FROM users WHERE id = $1', [userId]),
    ]);
    const quantity = new Map(owned.rows.map((row) => [row.potion_id, row.quantity]));
    return {
      items: POTION_IDS.map((id) => ({ id, name: POTIONS[id].name, description: POTIONS[id].description, price: POTIONS[id].price, quantity: quantity.get(id) ?? 0 })),
      loadout: parseLoadout(loadout.rows[0]?.potion_loadout),
      loadoutMax: POTION_LOADOUT_MAX,
    };
  }

  /** El precio sale del dominio, nunca del cliente; la clave de idempotencia evita cobrar dos veces un reintento. */
  async buy(userId: string, potionId: PotionId, purchaseId: string): Promise<{ balance: number; duplicate: boolean }> {
    return inTransaction(this.pool, async (client) => {
      const wallet = await client.query<{ balance: number }>('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const balance = wallet.rows[0]?.balance;
      if (balance === undefined) throw new ProblemError(404, 'WALLET_NOT_FOUND', 'El usuario no tiene billetera');
      const key = `potion:${userId}:${purchaseId}`;
      const previous = await client.query('SELECT 1 FROM wallet_transactions WHERE idempotency_key = $1', [key]);
      if ((previous.rowCount ?? 0) > 0) return { balance, duplicate: true };
      const price = POTIONS[potionId].price;
      if (balance < price) throw new ProblemError(409, 'INSUFFICIENT_FUNDS', 'No tienes suficientes Marcas de Ceniza');
      await client.query(`INSERT INTO wallet_transactions (id, user_id, amount, kind, idempotency_key) VALUES ($1, $2, $3, 'purchase', $4)`, [randomUUID(), userId, -price, key]);
      await client.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [price, userId]);
      await client.query(
        `INSERT INTO player_potions (user_id, potion_id, quantity) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, potion_id) DO UPDATE SET quantity = player_potions.quantity + 1`,
        [userId, potionId],
      );
      return { balance: balance - price, duplicate: false };
    });
  }

  /** Las pociones elegidas para la próxima partida: no pueden ser más de las que tiene. */
  async setLoadout(userId: string, requested: readonly PotionId[]): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const owned = await client.query<{ potion_id: string; quantity: number }>('SELECT potion_id, quantity FROM player_potions WHERE user_id = $1 FOR UPDATE', [userId]);
      const quantity = new Map(owned.rows.map((row) => [row.potion_id, row.quantity]));
      for (const id of new Set(requested)) {
        if (requested.filter((candidate) => candidate === id).length > (quantity.get(id) ?? 0)) {
          throw new ProblemError(409, 'POTION_NOT_OWNED', 'No tienes tantas pociones de ese tipo');
        }
      }
      await client.query('UPDATE users SET potion_loadout = $1::jsonb WHERE id = $2', [JSON.stringify(requested), userId]);
    });
  }
}

function parseLoadout(value: unknown): PotionId[] {
  return Array.isArray(value) ? value.filter((entry): entry is PotionId => typeof entry === 'string' && isPotionId(entry)).slice(0, POTION_LOADOUT_MAX) : [];
}

/**
 * Dentro de la transacción que crea la partida: descuenta las pociones elegidas del inventario y vacía la selección.
 * Lo que sobre vuelve al inventario sin tocar; lo que se lleva a la partida se gasta o se pierde, como pidió el diseño.
 */
export async function consumeLoadout(client: pg.ClientBase, userId: string): Promise<PotionId[]> {
  const row = await client.query<{ potion_loadout: unknown }>('SELECT potion_loadout FROM users WHERE id = $1 FOR UPDATE', [userId]);
  const wanted = parseLoadout(row.rows[0]?.potion_loadout);
  const taken: PotionId[] = [];
  for (const id of wanted) {
    const updated = await client.query(`UPDATE player_potions SET quantity = quantity - 1 WHERE user_id = $1 AND potion_id = $2 AND quantity > 0`, [userId, id]);
    if ((updated.rowCount ?? 0) > 0) taken.push(id);
  }
  if (wanted.length > 0) await client.query(`UPDATE users SET potion_loadout = '[]'::jsonb WHERE id = $1`, [userId]);
  return taken;
}

export function registerPotionRoutes(app: FastifyInstance, auth: AuthService, pool: pg.Pool): void {
  const potions = new PotionService(pool);

  app.get('/v1/me/potions', async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    return potions.inventory(userId);
  });

  app.post<{ Body: Static<typeof BuyPotion> }>('/v1/shop/potions', { schema: { body: BuyPotion } }, async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    return potions.buy(userId, request.body.potionId, request.body.purchaseId);
  });

  app.put<{ Body: Static<typeof SetLoadout> }>('/v1/me/loadout', { schema: { body: SetLoadout } }, async (request, reply) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    await potions.setLoadout(userId, request.body.potions);
    return reply.code(204).send();
  });
}
