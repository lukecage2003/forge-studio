import { X, Crown, Wand2, ImagePlus } from 'lucide-react';
import { setUI, update, useStore } from '../store';
import { brandOf } from '../engine/brand';
import { ThumbnailStudio } from './ThumbnailStudio';

export function ChannelModal() {
  const project = useStore((s) => s.project);
  const b = brandOf(project);
  const set = (patch: Partial<typeof b>) => update((p) => ({ ...p, brand: { ...p.brand, ...patch } }));
  const close = () => setUI({ channelOpen: false });
  const uploadLogo = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    i.onchange = () => {
      const f = i.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => set({ logo: r.result as string });
      r.readAsDataURL(f);
    };
    i.click();
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal channel-modal" role="dialog" aria-labelledby="ch-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Crown size={18} /></span>
            <div><h2 id="ch-title">Ma chaîne</h2><p>Miniatures, intro, chapitres et écran de fin à tes couleurs.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>

        <section className="set-section">
          <h3><Wand2 size={15} /> Miniature YouTube</h3>
          <ThumbnailStudio />
        </section>

        <section className="set-section">
          <div className="brand-row">
            <img src={b.logo} alt="Logo de la chaîne" className="brand-logo" />
            <div className="brand-fields">
              <label className="color-row"><input type="color" value={b.bg} onChange={(e) => set({ bg: e.target.value })} /><span>Fond · {b.bg}</span></label>
              <label className="color-row"><input type="color" value={b.ink} onChange={(e) => set({ ink: e.target.value })} /><span>Titres · {b.ink}</span></label>
              <div className="row-btns gap">
                <button className="btn sm ghost" onClick={uploadLogo}><ImagePlus size={14} /> Mon logo</button>
                <button className="link-btn" onClick={() => set({ logo: 'channel-logo.svg' })}>Logo par défaut</button>
              </div>
            </div>
          </div>
          <label className="toggle"><input type="checkbox" checked={b.intro} onChange={(e) => set({ intro: e.target.checked })} /><span className="switch" /><span>Intro logo (1,2 s) au début de chaque vidéo</span></label>
          <label className="toggle"><input type="checkbox" checked={b.outro} onChange={(e) => set({ outro: e.target.checked })} /><span className="switch" /><span>Écran de fin YouTube (10 s)<small>Uniquement en 16:9</small></span></label>
        </section>
      </div>
    </div>
  );
}
