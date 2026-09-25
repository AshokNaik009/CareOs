export default function Banner({ text }) {
  return text ? <div className="banner">{text}</div> : null;
}
