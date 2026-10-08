import { describe, expect, it } from 'vitest';

import { describeFlowPaths, traceDataFlow } from '../src/state/data-flow';
import {
  computeBreadcrumbs,
  computeVisibleGraph,
  initialViewState,
} from '../src/state/view-state';
import { buildGraphFromSources, nodeByName } from '@kestrel/core/testing';

const MANIFESTS = {
  'apps/api/package.json': JSON.stringify({
    name: 'api',
    dependencies: { '@nestjs/core': '^10.0.0', '@prisma/client': '^5.0.0' },
  }),
  'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }),
  'prisma/schema.prisma': `
datasource db {
  provider = "postgresql"
}

model Order {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
}

model User {
  id     String  @id
  orders Order[]
}
`,
};

/** A full stack path: page → hook → client → controller → service → model → db. */
const SOURCES: Record<string, string> = {
  'apps/web/src/app/app.tsx': `
import { Route, Routes } from 'react-router-dom';
import { Orders } from './pages/Orders';

export function App() {
  return (
    <Routes>
      <Route path="/orders" element={<Orders />} />
    </Routes>
  );
}
`,
  'apps/web/src/app/pages/Orders.tsx': `
import { useOrders } from '../data/useOrders';

export function Orders() {
  return <div>{useOrders().length}</div>;
}
`,
  'apps/web/src/app/data/useOrders.ts': `
import { api } from './api';

export function useOrders() {
  return api.get('/api/v1/orders');
}
`,
  'apps/web/src/app/data/api.ts': `
export const api = {
  get: (path: string) => fetch(path),
};
`,
  'apps/api/src/orders/orders.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('api/v1')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  list() {
    return this.orders.findAll();
  }
}
`,
  'apps/api/src/orders/orders.service.ts': `
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.order.findMany();
  }
}
`,
  'apps/api/src/prisma/prisma.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class PrismaService {}
`,
};

const graph = buildGraphFromSources(SOURCES, 'monorepo', MANIFESTS);
const id = (name: string): string => nodeByName(graph, name).id;
const names = (ids: Iterable<string>): string[] =>
  [...ids].map((nodeId) => graph.nodes.find((node) => node.id === nodeId)?.name ?? nodeId).sort();

describe('data flow tracing', () => {
  it('follows the data downstream to the datastore', () => {
    const flow = traceDataFlow(graph, [id('OrdersController')], { direction: 'downstream' });

    expect(names(flow.nodeIds)).toEqual(
      expect.arrayContaining(['OrdersController', 'OrdersService', 'Order', 'PostgreSQL']),
    );
  });

  it('follows the data upstream to the entry point', () => {
    const flow = traceDataFlow(graph, [id('OrdersService')], { direction: 'upstream' });
    const reached = names(flow.nodeIds);

    expect(reached).toContain('OrdersController');
    expect(reached).toContain('useOrders');
    expect(reached).toContain('Orders');
  });

  it('crosses the network boundary from the UI into the API', () => {
    const flow = traceDataFlow(graph, [id('Orders')], { direction: 'downstream' });

    expect(names(flow.nodeIds)).toEqual(
      expect.arrayContaining(['Orders', 'useOrders', 'OrdersController', 'OrdersService', 'Order']),
    );
  });

  it('ignores structural edges that carry no data', () => {
    // The `pages` feature module contains a page; containment is not a data path.
    const flow = traceDataFlow(graph, [id('pages')], { direction: 'downstream' });

    expect([...flow.nodeIds]).toEqual([id('pages')]);
  });

  it('reports both directions through a component by default', () => {
    const flow = traceDataFlow(graph, [id('OrdersService')]);
    const reached = names(flow.nodeIds);

    expect(reached).toContain('Orders');
    expect(reached).toContain('PostgreSQL');
  });

  it('stops at the requested depth and says it was cut short', () => {
    const flow = traceDataFlow(graph, [id('Orders')], { direction: 'downstream', maxDepth: 1 });

    expect(names(flow.nodeIds)).toEqual(['Orders', 'useOrders']);
    expect(flow.truncated).toBe(true);
  });

  it('never revisits a node, so a cycle cannot loop forever', () => {
    const cyclic = buildGraphFromSources({
      'src/a.service.ts': `
import { Injectable } from '@nestjs/common';
import { BService } from './b.service';

@Injectable()
export class AService {
  constructor(private readonly b: BService) {}
}
`,
      'src/b.service.ts': `
import { Injectable } from '@nestjs/common';
import { AService } from './a.service';

@Injectable()
export class BService {
  constructor(private readonly a: AService) {}
}
`,
    });

    const start = cyclic.nodes.find((node) => node.name === 'AService');
    const flow = traceDataFlow(cyclic, [start?.id ?? ''], { direction: 'downstream' });

    expect(flow.nodeIds.size).toBe(2);
  });
});

describe('flow paths', () => {
  it('reads as an end to end chain from entry point to datastore', () => {
    const flow = traceDataFlow(graph, [id('OrdersService')]);
    const paths = describeFlowPaths(graph, flow, [id('OrdersService')]);

    const longest = paths[0];
    const chain = [longest[0].from, ...longest.map((leg) => leg.to)];

    // Entry point first, datastore last, with every hop in between in order.
    expect(chain[0]).toBe('Orders');
    expect(chain[chain.length - 1]).toBe('PostgreSQL');
    for (const [before, after] of [
      ['Orders', 'useOrders'],
      ['useOrders', 'OrdersController'],
      ['OrdersController', 'OrdersService'],
      ['OrdersService', 'Order'],
    ]) {
      expect(chain.indexOf(before)).toBeLessThan(chain.indexOf(after));
    }
  });

  it('carries node ids so a step can be clicked', () => {
    const flow = traceDataFlow(graph, [id('OrdersController')], { direction: 'downstream' });
    const [path] = describeFlowPaths(graph, flow, [id('OrdersController')]);

    expect(path[0].fromId).toBe(id('OrdersController'));
    expect(path[0].toId).toBe(id('OrdersService'));
    expect(path[0].type).toBe('injects');
  });
});

describe('flow view', () => {
  it('shows exactly the traced nodes', () => {
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      level: 'flow',
      flowSeedIds: [id('OrdersController')],
      flowDirection: 'downstream',
    });

    // `User` is on the trace too: an Order references it, and a model relation
    // is a data relationship.
    expect(visible.nodes.map((node) => node.name).sort()).toEqual([
      'Order',
      'OrdersController',
      'OrdersService',
      'PostgreSQL',
      'User',
    ]);
  });

  it('marks the traced edges so they can be animated', () => {
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      level: 'flow',
      flowSeedIds: [id('OrdersController')],
      flowDirection: 'downstream',
    });

    expect(visible.flowEdgeIds.size).toBe(visible.edges.length);
    expect(visible.edges.every((edge) => visible.flowEdgeIds.has(edge.id))).toBe(true);
  });

  it('keeps the whole chain even when a layer is hidden', () => {
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      level: 'flow',
      flowSeedIds: [id('OrdersController')],
      flowDirection: 'downstream',
      // Hiding the data layer must not cut the trace in half.
      hiddenLayers: ['data'],
    });

    expect(visible.nodes.map((node) => node.name)).toContain('PostgreSQL');
  });

  it('names the trace in the breadcrumbs', () => {
    const crumbs = computeBreadcrumbs(graph, {
      ...initialViewState,
      level: 'flow',
      flowSeedIds: [id('OrdersController')],
    });

    expect(crumbs[crumbs.length - 1].label).toBe('Data flow · OrdersController');
  });
});
