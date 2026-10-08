import type { ProjectStatus } from '@kestrel/protocol';

const LABELS: Record<ProjectStatus, string> = {
  idle: 'Not started',
  provisioning: 'Creating sandbox',
  installing: 'Installing',
  starting: 'Starting',
  ready: 'Running',
  running: 'Running (no preview)',
  error: 'Error',
  stopped: 'Stopped',
};

const TONE: Record<ProjectStatus, string> = {
  idle: '',
  provisioning: 'status--busy',
  installing: 'status--busy',
  starting: 'status--busy',
  ready: 'status--ok',
  running: 'status--ok',
  error: 'status--error',
  stopped: '',
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status ${TONE[status]}`}>
      <span className="status__dot" aria-hidden />
      {LABELS[status]}
    </span>
  );
}

export function isBusy(status: ProjectStatus): boolean {
  return status === 'provisioning' || status === 'installing' || status === 'starting';
}
