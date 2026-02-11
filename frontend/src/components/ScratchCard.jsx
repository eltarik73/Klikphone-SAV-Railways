import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { Loader2 } from 'lucide-react';

export default function ScratchCard({ ticketCode }) {
  const canvasRef = useRef(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isScratching, setIsScratching] = useState(false);
  const [frequence, setFrequence] = useState(10);
  const [actif, setActif] = useState(true);
  const revealedRef = useRef(false);

  // Load initial state
  useEffect(() => {
    if (!ticketCode) return;
    api.getGrattage(ticketCode)
      .then(data => {
        if (!data.actif) {
          setActif(false);
          return;
        }
        setFrequence(data.frequence || 10);
        if (data.deja_gratte) {
          setResult({
            gagnant: !!data.gain,
            gain: data.gain,
            gain_label: data.gain_label,
            deja_gratte: true,
          });
          setIsRevealed(true);
          revealedRef.current = true;
        }
      })
      .catch(() => setActif(false))
      .finally(() => setLoading(false));
  }, [ticketCode]);

  // Initialize canvas
  useEffect(() => {
    if (loading || isRevealed || !actif) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#C0C0C0');
    gradient.addColorStop(0.5, '#D4D4D4');
    gradient.addColorStop(1, '#A8A8A8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Shimmer effect
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(i * 60, 0, 20, canvas.height);
    }

    ctx.fillStyle = '#888';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GRATTEZ ICI', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Tentez votre chance !', canvas.width / 2, canvas.height / 2 + 15);
  }, [loading, isRevealed, actif]);

  const scratch = useCallback((e) => {
    if (revealedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX == null) return;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 25, 0, Math.PI * 2);
    ctx.fill();

    // Calculate scratch percentage
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = 0;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0) transparent++;
    }
    const pct = (transparent / (imageData.data.length / 4)) * 100;

    if (pct > 45 && !revealedRef.current) {
      revealedRef.current = true;
      revealResult();
    }
  }, [ticketCode]);

  const revealResult = async () => {
    setIsRevealed(true);
    try {
      const data = await api.gratter(ticketCode);
      setResult(data);
    } catch (err) {
      setResult({ gagnant: false, error: err.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!actif) return null;

  // Already scratched
  if (isRevealed && result?.deja_gratte) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 text-center">
        <p className="text-sm text-slate-500">Vous avez déjà gratté ce ticket</p>
        {result.gain && (
          <p className="text-lg font-bold text-emerald-600 mt-2">
            {result.gain === 'film' ? '🎁' : '💰'} {result.gain_label}
          </p>
        )}
        {!result.gain && (
          <p className="text-sm text-slate-400 mt-1">Retentez votre chance au prochain passage !</p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-violet-200 p-6 text-center shadow-lg">
      <h3 className="text-lg font-bold text-violet-700 mb-2">
        <span className="text-xl">🎰</span> Tentez votre chance !
      </h3>
      <p className="text-sm text-slate-500 mb-4">Grattez pour découvrir si vous avez gagné</p>

      <div className="relative inline-block mx-auto rounded-xl overflow-hidden" style={{ width: 280, height: 140 }}>
        {/* Hidden content */}
        <div className="absolute inset-0 flex items-center justify-center"
          style={{
            background: isRevealed
              ? (result?.gagnant
                ? 'linear-gradient(135deg, #fbbf24, #f59e0b)'
                : '#f1f5f9')
              : '#e2e8f0'
          }}
        >
          {isRevealed ? (
            result?.gagnant ? (
              <div className="text-center" style={{ animation: 'bounceIn 0.5s ease-out' }}>
                <div className="text-4xl mb-1">🎉</div>
                <div className="text-lg font-extrabold text-white">GAGNÉ !</div>
                <div className="text-sm font-semibold text-white/90">
                  {result.gain === 'film' ? '🎁' : '💰'} {result.gain_label}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-3xl mb-1">😊</div>
                <div className="text-sm font-semibold text-slate-500">Pas cette fois !</div>
                <div className="text-xs text-slate-400">Retentez au prochain passage</div>
              </div>
            )
          ) : (
            <div className="text-xs text-slate-400">?</div>
          )}
        </div>

        {/* Scratch canvas */}
        {!isRevealed && (
          <canvas
            ref={canvasRef}
            width={280}
            height={140}
            className="absolute inset-0 cursor-pointer"
            style={{ touchAction: 'none' }}
            onMouseDown={() => setIsScratching(true)}
            onMouseUp={() => setIsScratching(false)}
            onMouseLeave={() => setIsScratching(false)}
            onMouseMove={(e) => isScratching && scratch(e)}
            onTouchStart={() => setIsScratching(true)}
            onTouchEnd={() => setIsScratching(false)}
            onTouchMove={(e) => scratch(e)}
          />
        )}
      </div>

      <p className="text-[10px] text-slate-400 mt-3">
        1 chance sur {frequence} de gagner un film verre trempé ou une réduction
      </p>

      <style>{`
        @keyframes bounceIn {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.9); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
