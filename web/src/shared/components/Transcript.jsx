import { useLayoutEffect, useRef } from 'react';

export default function Transcript({ messages }) {
  const box = useRef(null);
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [messages]);
  return (
    <div className="transcript" ref={box}>
      {messages.map((m) => <div key={m.id} className={`msg ${m.cls}`} dir="auto">{m.text}</div>)}
    </div>
  );
}
