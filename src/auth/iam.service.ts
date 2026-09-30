import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool, PoolClient } from 'pg';
import { Request } from 'express';
import { PG_POOL } from '../shared/connections/database.module';

export const Public = () => SetMetadata('iam.public', true);
export const Permissions = (...permissions: string[]) =>
  SetMetadata('iam.permissions', permissions);
export interface Actor {
  userId: string;
  memberId: string;
  permissions: string[];
  token: string;
}
export type AuthRequest = Request & { actor: Actor };

@Injectable()
export class IamService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async validate(
    token: string,
    mutation?: { csrf?: string; origin?: string },
  ): Promise<Actor> {
    const base = process.env.IAM_BASE_URL;
    const secret = process.env.IAM_SERVICE_TOKEN;
    if (!base || !secret || secret.length < 43)
      throw new ServiceUnavailableException('IAM_NOT_CONFIGURED');
    let response: Response;
    try {
      const url = new URL(base);
      if (
        url.username ||
        url.password ||
        (url.protocol !== 'https:' &&
          !(
            process.env.NODE_ENV !== 'production' &&
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(url.hostname)
          ))
      )
        throw new Error();
      response = await fetch(
        `${base.replace(/\/$/, '')}/internal/sessions/validate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            ...(mutation ? { mutation: true, ...mutation } : {}),
          }),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        },
      );
    } catch {
      throw new ServiceUnavailableException('IAM_UNAVAILABLE');
    }
    if (response.status === 401)
      throw new UnauthorizedException('SESSION_INVALID');
    if (response.status === 403)
      throw new ForbiddenException('ACCESS_OR_CSRF_DENIED');
    if (!response.ok) throw new ServiceUnavailableException('IAM_UNAVAILABLE');
    const value = await response.json().catch(() => null);
    if (
      value?.application !== (process.env.IAM_APPLICATION_CODE || 'rafael') ||
      value?.access !== 'enabled' ||
      typeof value?.user?.id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(value.user.id) ||
      !Array.isArray(value.permissions) ||
      !value.permissions.every((p: unknown) => typeof p === 'string')
    )
      throw new ServiceUnavailableException('IAM_INVALID_RESPONSE');
    const { rows } = await this.pool.query(
      "SELECT id::text FROM public.miembros WHERE iam_subject=$1 AND estado='activo'",
      [value.user.id],
    );
    if (!rows[0] || rows[0].id !== value.member?.id)
      throw new ForbiddenException('MEMBER_NOT_ACTIVE');
    return {
      userId: value.user.id,
      memberId: rows[0].id,
      permissions: value.permissions,
      token,
    };
  }
  require(actor: Actor, ...permissions: string[]) {
    if (!permissions.every((p) => actor.permissions.includes(p)))
      throw new ForbiddenException('PERMISSION_REQUIRED');
  }
  async revalidate(client: PoolClient, actor: Actor, ...permissions: string[]) {
    const fresh = await this.validate(actor.token);
    if (fresh.userId !== actor.userId || fresh.memberId !== actor.memberId)
      throw new ForbiddenException('IDENTITY_CHANGED');
    this.require(fresh, ...permissions);
    const result = await client.query(
      "SELECT id FROM public.miembros WHERE id=$1 AND iam_subject=$2 AND estado='activo' FOR SHARE",
      [actor.memberId, actor.userId],
    );
    if (!result.rowCount) throw new ForbiddenException('MEMBER_NOT_ACTIVE');
  }
}

@Injectable()
export class IamGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly iam: IamService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('iam.public', targets))
      return true;
    const required = this.reflector.getAllAndOverride<string[]>(
      'iam.permissions',
      targets,
    );
    if (!required) throw new ForbiddenException('ROUTE_NOT_AUTHORIZED');
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const cookieName =
      process.env.IAM_SESSION_COOKIE || '__Host-exdev_rafael_session';
    const cookies = (request.headers.cookie || '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${cookieName}=`));
    const token =
      cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('SESSION_REQUIRED');
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    request.actor = await this.iam.validate(
      token,
      mutation
        ? { csrf: request.get('X-CSRF-Token'), origin: request.get('Origin') }
        : undefined,
    );
    this.iam.require(request.actor, ...required);
    return true;
  }
}
