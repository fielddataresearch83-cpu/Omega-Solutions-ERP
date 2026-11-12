import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { tenantDatabaseContext } from './tenant-database-context.js';

interface AuthenticatedRequest {
  user?: AuthenticatedUser;
}

@Injectable()
export class TenantDatabaseContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // Unauthenticated bootstrap flows deliberately remain outside tenant scope.
    // The context is sourced only from the server-validated JWT strategy.
    const companyId = user?.companyId;
    if (!user?.userId || typeof companyId !== 'string' || companyId.length === 0) return next.handle();

    return new Observable((subscriber) =>
      tenantDatabaseContext.run(
        { userId: user.userId, companyId, branchId: user.branchId ?? null },
        () => next.handle().subscribe(subscriber),
      ),
    );
  }
}
