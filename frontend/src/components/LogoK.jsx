// Marque « K » en aplat brand-600 (le PNG public/logo_k.png est un dégradé violet : réservé aux favicons).
// `label` donne un nom accessible (role img) ; sans label, l'icône est décorative.
export default function LogoK({ className = 'w-10 h-10', label }) {
  return (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} rounded-lg shrink-0`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <rect width="200" height="200" rx="28" className="fill-brand-600" />
      <path d="M62 42 L84 42 L84 89 L130 42 L156 42 L106 98 L158 158 L130 158 L84 111 L84 158 L62 158 Z" fill="white" />
    </svg>
  );
}
