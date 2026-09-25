import { useState } from 'react';

export default function Composer({ placeholder, onSend }) {
  const [value, setValue] = useState('');
  function submit(e) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSend(v);
    setValue('');
  }
  return (
    <form className="composer" onSubmit={submit}>
      <input autoComplete="off" placeholder={placeholder} dir="auto" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn primary sm" type="submit">Send</button>
    </form>
  );
}
