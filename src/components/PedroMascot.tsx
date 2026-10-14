import '../styles/mascot.css';

const pedroMascot = new URL('../assets/pedro-icon.svg', import.meta.url).href;

/** Shared decorative mark; the surrounding label names the app or action. */
export function PedroMascot({ className = '' }: { className?: string }) {
  return <img src={pedroMascot} className={`pedro-mascot${className ? ` ${className}` : ''}`} alt="" aria-hidden="true" draggable={false} />;
}
