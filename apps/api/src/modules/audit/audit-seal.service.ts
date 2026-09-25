import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

const BATCH = 500;

export interface AuditIntegrity {
  ok: boolean;
  checked: number;
  unsealed: number;
  headSeq: number;
  problem: { seq: number; auditId: string | null; message: string } | null;
  /** Resultado de comparar un sello guardado fuera del sistema (p. ej. el del reporte semanal). */
  anchor?: { seq: number; matches: boolean };
  verifiedAt: string;
}

/**
 * Sellado de la auditoría con hash encadenado (docs/11 §195). El cálculo vive en PostgreSQL
 * (seal_audit_logs / verify_audit_chain) para que la verificación no dependa del código del API.
 */
@Injectable()
export class AuditSealService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuditSealService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (env.NODE_ENV === 'test' || env.AUDIT_SEAL_INTERVAL_SEC === 0) return;
    this.timer = setInterval(() => void this.seal(), env.AUDIT_SEAL_INTERVAL_SEC * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sella todo lo pendiente (con más de 1 minuto de antigüedad), en lotes. */
  async seal(minAge = '1 minute'): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let total = 0;
    try {
      for (;;) {
        const [row] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT seal_audit_logs(${BATCH}::int, ${minAge}::interval) AS n`;
        total += row?.n ?? 0;
        if (!row || row.n < BATCH) break;
      }
      if (total) this.logger.log(`Auditoría: ${total} registros sellados`);
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running = false;
    }
    return total;
  }

  async verify(anchor?: { seq: number; hash: string }): Promise<AuditIntegrity> {
    const [r] = await this.prisma.$queryRaw<{ checked: bigint; unsealed: bigint; head_seq: bigint; bad_seq: bigint | null; bad_id: bigint | null; problem: string | null }[]>`
      SELECT * FROM verify_audit_chain()`;
    if (r?.problem) this.logger.error(`Auditoría: integridad comprometida en el sello #${String(r.bad_seq)}: ${r.problem}`);
    let anchorResult: AuditIntegrity['anchor'];
    if (anchor) {
      const row = await this.prisma.auditLog.findFirst({ where: { sealSeq: BigInt(anchor.seq) }, select: { hash: true } });
      const matches = !!row?.hash && Buffer.from(row.hash).toString('hex').startsWith(anchor.hash.toLowerCase());
      anchorResult = { seq: anchor.seq, matches };
    }
    return {
      ok: !r?.problem && anchorResult?.matches !== false,
      anchor: anchorResult,
      checked: Number(r?.checked ?? 0),
      unsealed: Number(r?.unsealed ?? 0),
      headSeq: Number(r?.head_seq ?? 0),
      problem: r?.problem ? { seq: Number(r.bad_seq), auditId: r.bad_id === null ? null : String(r.bad_id), message: r.problem } : null,
      verifiedAt: new Date().toISOString(),
    };
  }
}
