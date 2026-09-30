import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type Data = Record<string, unknown>;
export type Parser = (value: unknown, field: string) => unknown;
export function bodyObject(
  raw: unknown,
  allowed: string[],
  partial = false,
): Data {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('El cuerpo debe ser un objeto');
  const body = raw as Data;
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new BadRequestException('El cuerpo contiene campos no permitidos');
  if (partial && !Object.keys(body).length)
    throw new BadRequestException('Debes enviar al menos un campo');
  return body;
}
export function id(value: unknown, field = 'id'): string {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value
        : '';
  if (!/^[1-9]\d*$/.test(text) || BigInt(text) > 9223372036854775807n)
    throw new BadRequestException(`${field} inválido`);
  return text;
}
export function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException(`${field} es obligatorio`);
  return value.trim();
}
export function optionalText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string')
    throw new BadRequestException(`${field} debe ser texto`);
  return value.trim() || null;
}
export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    throw new BadRequestException(`${field} debe ser booleano`);
  return value;
}
export const choice =
  (values: string[]): Parser =>
  (value, field) => {
    if (typeof value !== 'string' || !values.includes(value))
      throw new BadRequestException(`${field} inválido`);
    return value;
  };
export function integer(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < -2147483648 ||
    value > 2147483647
  )
    throw new BadRequestException(`${field} debe ser un entero válido`);
  return value;
}
export function date(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException(
      `${field} debe ser una fecha válida YYYY-MM-DD`,
    );
  return value;
}
export const optionalDate: Parser = (value, field) =>
  value == null || value === '' ? null : date(value, field);
export function timestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new BadRequestException(
      `${field} debe incluir fecha, hora y zona horaria`,
    );
  date(value.slice(0, 10), field);
  return new Date(value).toISOString();
}
export const url: Parser = (value, field) => {
  const text = optionalText(value, field);
  if (!text) return null;
  if (/^\/(?![\/\\])/.test(text) && !text.includes('\\')) return text;
  try {
    if (['https:', 'http:'].includes(new URL(text).protocol)) return text;
  } catch {
    /* invalid URL */
  }
  throw new BadRequestException(
    `${field} debe ser una ruta interna o URL HTTP/HTTPS`,
  );
};
export function dateRange(start: unknown, end: unknown) {
  if (start && end && String(end) < String(start))
    throw new BadRequestException(
      'La fecha de término no puede ser anterior al inicio',
    );
}
export function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value))
    throw new BadRequestException(`${field} debe ser un arreglo`);
  const result = value.map((item) => id(item, field));
  if (new Set(result).size !== result.length)
    throw new BadRequestException(`${field} contiene IDs repetidos`);
  return result;
}
export function databaseError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const code = (error as { code?: string })?.code;
  if (['23505', '23P01'].includes(code))
    throw new ConflictException(
      'El registro se duplica o se superpone con otro existente',
    );
  if (
    [
      '23503',
      '23514',
      '23502',
      '22P02',
      '22007',
      '22008',
      '22003',
      '22001',
    ].includes(code)
  )
    throw new BadRequestException('Los datos o las relaciones no son válidos');
  throw new InternalServerErrorException(
    'No fue posible completar la operación',
  );
}
export async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
    }
    databaseError(error);
  } finally {
    client?.release(discard);
  }
}
export interface RecordSpec {
  table: string;
  fields: Record<string, Parser>;
  defaults: Data;
  validate?: (data: Data) => void;
}
// Table and column names are supplied exclusively by code-owned specifications.
export async function saveRecord(
  pool: Pool,
  spec: RecordSpec,
  raw: unknown,
  rawId?: string,
) {
  const patch = rawId !== undefined;
  const body = bodyObject(raw, Object.keys(spec.fields), patch);
  const recordId = patch ? id(rawId) : undefined;
  return transaction(pool, async (client) => {
    let current = spec.defaults;
    if (patch) {
      const columns = Object.keys(spec.fields).map((key) =>
        [date, optionalDate].includes(spec.fields[key])
          ? `to_char(${key},'YYYY-MM-DD') AS ${key}`
          : key,
      );
      const result = await client.query(
        `SELECT ${columns.join(', ')} FROM public.${spec.table} WHERE id = $1 FOR UPDATE`,
        [recordId],
      );
      if (!result.rows.length)
        throw new NotFoundException('Registro no encontrado');
      current = result.rows[0];
      for (const key of Object.keys(current))
        if (current[key] instanceof Date)
          current[key] = (current[key] as Date).toISOString();
    }
    const merged = { ...current, ...body };
    const data = Object.fromEntries(
      Object.entries(spec.fields).map(([key, parse]) => [
        key,
        parse(merged[key], key),
      ]),
    );
    spec.validate?.(data);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const result = patch
      ? await client.query(
          `UPDATE public.${spec.table} SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING id`,
          [...values, recordId],
        )
      : await client.query(
          `INSERT INTO public.${spec.table} (${keys.join(', ')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
          values,
        );
    return { id: result.rows[0].id };
  });
}
