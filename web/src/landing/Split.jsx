import { Fragment, createElement } from 'react';

// Renders text as per-word spans (.w, --i = word index) for the staggered reveal.
export default function Split({ as = 'p', className, children }) {
  const words = String(children).trim().split(/\s+/);
  return createElement(as, { className, 'data-split': '' }, words.map((w, i) => (
    <Fragment key={i}>
      <span className="w" style={{ '--i': i }}>{w}</span>
      {i < words.length - 1 ? ' ' : null}
    </Fragment>
  )));
}
