import { describe, expect, it } from 'vitest';

import { classifyLayer } from '../src/architecture/profile/layer-classifier';
import { MULTI_MODULE_APP, buildGraphFromSources, hasEdge, nodeByName } from './fixtures';

const TYPEORM_PACKAGE = JSON.stringify({
  name: 'shop-api',
  dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.0', pg: '^8.11.0' },
});

const LAYERED_APP: Record<string, string> = {
  'src/orders/order.entity.ts': `
import { Entity } from 'typeorm';

@Entity()
export class Order {}
`,
  'src/orders/orders.repository.ts': `
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './order.entity';

@Injectable()
export class OrdersRepository {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}
}
`,
  'src/orders/orders.service.ts': `
import { Injectable } from '@nestjs/common';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}
}
`,
  'src/orders/orders.controller.ts': `
import { Controller } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
}
`,
  'src/common/auth.guard.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthGuard {}
`,
  'src/orders/orders.module.ts': `
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
`,
};

describe('layer classification', () => {
  const graph = buildGraphFromSources(LAYERED_APP, 'shop-api', { 'package.json': TYPEORM_PACKAGE });

  it('places controllers in the presentation layer', () => {
    expect(nodeByName(graph, 'OrdersController').metadata?.layer).toBe('presentation');
  });

  it('places services in the business layer', () => {
    expect(nodeByName(graph, 'OrdersService').metadata?.layer).toBe('business');
  });

  it('places repositories and entities in the data layer', () => {
    expect(nodeByName(graph, 'OrdersRepository').metadata?.layer).toBe('data');
    expect(nodeByName(graph, 'Order').metadata?.layer).toBe('data');
  });

  it('places guards in the infrastructure layer', () => {
    expect(nodeByName(graph, 'AuthGuard').metadata?.layer).toBe('infrastructure');
  });

  it('gives modules and applications no layer', () => {
    expect(nodeByName(graph, 'OrdersModule').metadata?.layer).toBeUndefined();
    expect(nodeByName(graph, 'shop-api').metadata?.layer).toBeUndefined();
  });

  it('uses the folder when the class name is not conclusive', () => {
    expect(
      classifyLayer({ role: 'service', name: 'Mailer', filePath: 'src/infrastructure/mailer.ts' }),
    ).toBe('infrastructure');
    expect(classifyLayer({ role: 'service', name: 'Cart', filePath: 'src/domain/cart.ts' })).toBe('business');
    expect(classifyLayer({ role: 'provider', name: 'Users', filePath: 'src/repositories/users.ts' })).toBe(
      'data',
    );
  });

  it('uses heritage before falling back to the default', () => {
    expect(
      classifyLayer({
        role: 'service',
        name: 'Users',
        filePath: 'src/users.ts',
        heritage: ['BaseEntity'],
      }),
    ).toBe('data');
  });

  it('defaults an unremarkable provider to the business layer', () => {
    expect(classifyLayer({ role: 'service', name: 'Pricing', filePath: 'src/pricing.ts' })).toBe('business');
  });

  it('ignores the monorepo path when reading folder hints', () => {
    // Without the project root, `apps/api` would read as an `api` folder.
    expect(
      classifyLayer({
        role: 'service',
        name: 'Pricing',
        filePath: 'apps/api/src/pricing.ts',
        projectRoot: 'apps/api',
      }),
    ).toBe('business');
  });

  it('puts the database handle itself in the data layer', () => {
    // PrismaService is named like a service but is the data gateway.
    expect(
      classifyLayer({ role: 'service', name: 'PrismaService', filePath: 'src/prisma.service.ts' }),
    ).toBe('data');
  });

  it('keeps a plain *Service class in the business layer', () => {
    expect(classifyLayer({ role: 'service', name: 'AuthService', filePath: 'src/auth/auth.service.ts' })).toBe(
      'business',
    );
    expect(
      classifyLayer({ role: 'service', name: 'ConfigService', filePath: 'src/config.service.ts' }),
    ).toBe('infrastructure');
  });

  it('leaves an unprofiled workspace with layers derived from roles alone', () => {
    const plain = buildGraphFromSources(MULTI_MODULE_APP);
    expect(nodeByName(plain, 'AuthController').metadata?.layer).toBe('presentation');
    expect(nodeByName(plain, 'AuthService').metadata?.layer).toBe('business');
  });
});

describe('datastore edges', () => {
  const graph = buildGraphFromSources(LAYERED_APP, 'shop-api', { 'package.json': TYPEORM_PACKAGE });

  it('creates a database node for the detected engine', () => {
    const database = nodeByName(graph, 'PostgreSQL');

    expect(database.type).toBe('database');
    expect(database.metadata?.access).toBe('TypeORM');
    expect(database.metadata?.layer).toBe('data');
  });

  it('links the repository to the entity it persists', () => {
    expect(hasEdge(graph, 'persists', 'OrdersRepository', 'Order')).toBe(true);
    expect(nodeByName(graph, 'OrdersRepository').metadata?.accessesDatabase).toBe(true);
  });

  it('links the entity to the database', () => {
    expect(hasEdge(graph, 'persists', 'Order', 'PostgreSQL')).toBe(true);
  });

  it('does not turn ORM handles into architecture nodes', () => {
    expect(graph.nodes.map((node) => node.name)).not.toContain('Repository');
  });

  it('registers entities declared through TypeOrmModule.forFeature with the module', () => {
    expect(hasEdge(graph, 'contains', 'OrdersModule', 'Order')).toBe(true);
  });

  it('produces a layered controller → service → repository → entity → database chain', () => {
    expect(hasEdge(graph, 'injects', 'OrdersController', 'OrdersService')).toBe(true);
    expect(hasEdge(graph, 'injects', 'OrdersService', 'OrdersRepository')).toBe(true);
    expect(hasEdge(graph, 'persists', 'OrdersRepository', 'Order')).toBe(true);
    expect(hasEdge(graph, 'persists', 'Order', 'PostgreSQL')).toBe(true);
  });

  it('falls back to the database when the entity cannot be resolved', () => {
    const withoutEntity = buildGraphFromSources(
      {
        'src/reports/reports.service.ts': `
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}
}
`,
      },
      'shop-api',
      { 'package.json': TYPEORM_PACKAGE },
    );

    expect(hasEdge(withoutEntity, 'persists', 'ReportsService', 'PostgreSQL')).toBe(true);
  });

  it('emits no persistence edges when no database was detected', () => {
    const plain = buildGraphFromSources(LAYERED_APP);
    expect(plain.edges.filter((edge) => edge.target.startsWith('database#'))).toHaveLength(0);
    // The repository → entity link does not depend on knowing the engine.
    expect(hasEdge(plain, 'persists', 'OrdersRepository', 'Order')).toBe(true);
  });
});
