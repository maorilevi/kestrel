import Link from 'next/link';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand__mark" aria-hidden />
      KESTREL
    </Link>
  );
}
