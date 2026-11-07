import type { FastifyBaseLogger } from 'fastify';
import type { PublishedEvent } from '../matches/match-engine.js';

/**
 * Registro de la partida, siempre con matchId y playerId. Nunca incluye ángulo, potencia, actionId ni trayectoria.
 * Las jugadas van a debug: a info, un log por jugada costaría CPU justo bajo carga.
 */
export function logMatchEvents(logger: FastifyBaseLogger, matchId: string, events: readonly PublishedEvent[]): void {
  for (const { event, stateAfter } of events) {
    const { payload } = event;
    const seq = event.seq;
    switch (payload.type) {
      case 'match_started':
        logger.info({ matchId, seq, playerIds: stateAfter.players.map((player) => player.playerId), arenaId: stateAfter.setup.arenaId }, 'Partida iniciada');
        break;
      case 'shot_resolved':
        logger.debug({ matchId, seq, playerId: payload.shooterId, impactKind: payload.outcome.impactKind, damage: payload.damage }, 'Jugada confirmada');
        break;
      case 'turn_timed_out':
        logger.info({ matchId, seq, playerId: payload.playerId }, 'Turno vencido');
        break;
      case 'player_disconnected':
        logger.info({ matchId, seq, playerId: payload.playerId }, 'Jugador desconectado');
        break;
      case 'player_reconnected':
        logger.info({ matchId, seq, playerId: payload.playerId }, 'Jugador reconectado');
        break;
      case 'match_finished':
        logger.info({ matchId, seq, reason: payload.result.reason, winnerId: payload.result.winnerId, rounds: payload.result.rounds }, 'Partida terminada');
        break;
      case 'turn_started':
        break;
    }
  }
}
