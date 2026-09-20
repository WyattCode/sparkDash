import { BoltIcon } from './icons';

export function BrandLink() {
  return <a href="/" className="logo-pill shared-brand" aria-label="sparkDash 首页并刷新" title="返回首页并刷新页面">
    <BoltIcon className="h-3.5 w-3.5 text-accent" />
    <span>spark<span className="logo-pill-dash" translate="no">Dash</span></span>
  </a>;
}
