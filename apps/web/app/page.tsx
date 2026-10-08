import Link from 'next/link';

import { Brand } from '@/components/Brand';

const OVERLAYS = [
  {
    tag: 'code',
    title: 'Architecture you can steer',
    body: 'Every module, service, endpoint and page as a live map, built deterministically from the code and kept current as it changes.',
  },
  {
    tag: 'agent',
    title: 'Change the system, not files',
    body: 'Select part of the architecture and say what you want. The agent gets the architectural context; you get the diff on the map.',
    soon: true,
  },
  {
    tag: 'devops',
    title: 'Ship from the canvas',
    body: 'Previews for every change and one-click deploys, with each application on the map showing where it runs.',
    soon: true,
  },
  {
    tag: 'prod',
    title: 'Production on the map',
    body: 'Latency, errors and live traces drawn on the components and calls they belong to.',
    soon: true,
  },
  {
    tag: 'growth',
    title: 'Product analytics in place',
    body: 'Events, funnels and experiments attached to the pages and endpoints that produce them.',
    soon: true,
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <nav className="landing__nav">
        <Brand />
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/login" className="btn btn--ghost">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn--primary">
            Get started
          </Link>
        </div>
      </nav>

      <header className="landing__hero">
        <div className="landing__eyebrow">AI-native · architecture-first</div>
        <h1 className="landing__title">Build your product from the architecture down.</h1>
        <p className="landing__lead">
          KESTREL is a development environment for engineers who want to see the whole system. Start from a prompt or
          your existing repository, and work on it from above: code, infrastructure, production and analytics on one
          live map.
        </p>
        <div className="landing__cta">
          <Link href="/signup" className="btn btn--primary">
            Start a project
          </Link>
          <Link href="/signup?import=github" className="btn">
            Import a GitHub repository
          </Link>
        </div>
      </header>

      <section className="landing__grid" aria-label="What KESTREL puts on the map">
        {OVERLAYS.map((overlay) => (
          <article key={overlay.tag} className={`overlay-card${overlay.soon ? ' overlay-card--soon' : ''}`}>
            <span className="overlay-card__tag">
              {overlay.tag}
              {overlay.soon ? ' · coming soon' : ''}
            </span>
            <h3>{overlay.title}</h3>
            <p>{overlay.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
