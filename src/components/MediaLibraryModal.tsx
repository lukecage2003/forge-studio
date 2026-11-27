import { useEffect, useMemo, useState } from 'react';
import { X, Images, Search, Sparkles, Loader2, Plus, Copy, Film, Music, FolderOpen } from 'lucide-react';
import { setUI, useStore } from '../store';
import { PAGE_KINDS } from '../types';
import type { LibEntry, LibIndex } from '../lib/mediaLibrary';
import { duplicates, searchText, clipQuery } from '../lib/mediaLibrary';
import { toast } from './Toast';

type Row = { e: LibEntry; score: number };

export function MediaLibraryModal() {
  const projectId = useStore((s) => s.project.id);
  const where = useStore((s) => s.ui.where);
  const [data, setData] = useState<{ entries: LibEntry[]; index: LibIndex } | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'mots' | 'image'>('mots');
  const [kind, setKind] = useState<'all' | 'image' | 'video' | 'audio' | 'dups'>('all');
  const [visual, setVisual] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<LibEntry | null>(null);
  const close = () => setUI({ mediaOpen: false });

  const load = async () => {
    const { workspace } = await import('../lib/studio');
    const ws = workspace();
    if (!ws) { setData({ entries: [], index: { v: 1, items: {} } }); return; }
    const { scanLibrary } = await import('../lib/mediaLibrary');
    setData(await scanLibrary(ws));
  };
  useEffect(() => { void load(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const dups = useMemo(() => (data ? duplicates(data.entries) : []), [data]);
  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    let list: Row[] = mode === 'image' && visual ? visual : q.trim() ? searchText(data.entries, q) : data.entries.map((e) => ({ e, score: 0 }));
    if (kind === 'dups') { const ids = new Set(dups.flat().map((x) => x.id)); list = list.filter((r) => ids.has(r.e.id)); }
    else if (kind !== 'all') list = list.filter((r) => r.e.kind === kind);
    return list.slice(0, 150);
  }, [data, q, mode, visual, kind, dups]);
  const embedded = data ? Object.values(data.index.items).filter((x) => x.clip).length : 0;
  const images = data?.entries.filter((e) => e.kind === 'image').length ?? 0;

  const index = async (clip: boolean) => {
    setBusy(clip ? 'Analyse visuelle des images (modèle téléchargé une fois, environ 150 Mo)…' : 'Empreintes des images…');
    const { runTask } = await import('../production/kinds');
    const t = await runTask('library.index', { clip });
    setBusy(null);
    if (t.state === 'done') { toast(clip ? 'Images analysées : la recherche par description est prête' : 'Empreintes calculées'); await load(); }
    else toast(t.error?.message ?? 'Analyse interrompue', 'error');
  };
  const searchVisual = async () => {
    if (!data || !q.trim()) return;
    setBusy('Recherche par description…');
    try {
      const { embedTexts, unpackVec, dot } = await import('../engine/clip');
      const [v] = await embedTexts([clipQuery(q)], (label, p) => setBusy(`${label} ${Math.round(p * 100)} %`));
      const scored = data.entries.filter((e) => data.index.items[e.id]?.clip).map((e) => ({ e, score: dot(v, unpackVec(data.index.items[e.id].clip!)) })).sort((a, b) => b.score - a.score);
      setVisual(scored);
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(null);
  };
  const add = async (ids: string[]) => {
    if (!data) return;
    const { addFromLibrary } = await import('../actions');
    const n = await addFromLibrary(data.entries.filter((e) => ids.includes(e.id) && e.kind === 'image'));
    if (n) setSel(new Set());
  };
  const openProject = async (id: string) => {
    const S = await import('../lib/studio');
    if (await S.openProject(id)) { toast('Projet ouvert'); close(); }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal media-modal" role="dialog" aria-labelledby="ml-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Images size={18} /></span>
            <div><h2 id="ml-title">Médiathèque</h2><p>Toutes les pages, voix et rushes de tes projets, avec leur provenance. Rien n’est copié : un ajout réutilise le même fichier.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>
        {where !== 'folder' && where !== 'browser' ? <p className="help">La médiathèque lit l’espace de projets : il n’est pas disponible pour l’instant (voir Projets → Stockage).</p> : (
          <>
            <div className="ml-search">
              <div className="seg" role="radiogroup" aria-label="Recherche">
                <button role="radio" aria-checked={mode === 'mots'} className={mode === 'mots' ? 'on' : ''} onClick={() => { setMode('mots'); setVisual(null); }}><Search size={13} /> Mots</button>
                <button role="radio" aria-checked={mode === 'image'} className={mode === 'image' ? 'on' : ''} onClick={() => setMode('image')}><Sparkles size={13} /> Description visuelle</button>
              </div>
              <input id="ml-q" className="input" placeholder={mode === 'mots' ? 'Nom, personnage, texte d’une bulle, série…' : 'Ce que montre l’image : un géant dans l’espace, une explosion…'} value={q} onChange={(e) => { setQ(e.target.value); if (mode === 'image') setVisual(null); }} onKeyDown={(e) => e.key === 'Enter' && mode === 'image' && void searchVisual()} />
              {mode === 'image' && <button className="btn sm primary" disabled={!q.trim() || !embedded || !!busy} onClick={() => void searchVisual()}>Chercher</button>}
              <select className="input sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Type">
                <option value="all">Tout</option><option value="image">Pages</option><option value="video">Rushes</option><option value="audio">Sons</option><option value="dups">Doublons ({dups.length})</option>
              </select>
            </div>
            {mode === 'image' && (
              <p className="help">{embedded ? `${embedded} / ${images} images analysées.` : 'Les images ne sont pas encore analysées.'} Recherche approximative : elle compare ta phrase aux images sur ton ordinateur (modèle CLIP). Elle marche mieux en anglais (« a giant pink robot eating planet earth ») ; en français, seuls les mots courants sont traduits. {embedded < images && <button className="link-btn" disabled={!!busy} onClick={() => void index(true)}>Analyser {images - embedded} image{images - embedded > 1 ? 's' : ''}</button>}</p>
            )}
            {kind === 'dups' && !Object.values(data?.index.items ?? {}).some((x) => x.hash) && <p className="help">Les doublons des anciens projets demandent leurs empreintes. <button className="link-btn" onClick={() => void index(false)}>Calculer les empreintes</button></p>}
            {busy && <p className="help"><Loader2 size={13} className="spin" /> {busy}</p>}
            <div className="ml-bar">
              <span className="help">{data ? `${rows.length} élément${rows.length > 1 ? 's' : ''}${q ? ' trouvés' : ''} · ${data.entries.length} au total` : 'Lecture de l’espace de projets…'}</span>
              {sel.size > 0 && <button className="btn sm primary" onClick={() => void add([...sel])}><Plus size={13} /> Ajouter {sel.size} page{sel.size > 1 ? 's' : ''} au projet ouvert</button>}
            </div>
            <ul className="ml-grid">
              {rows.map(({ e, score }) => (
                <li key={e.id} className={`${sel.has(e.id) ? 'on' : ''} ${open?.id === e.id ? 'open' : ''}`}>
                  <button className="ml-card" onClick={() => setOpen(e)} aria-label={e.name}>
                    {e.kind === 'image' ? <Thumb id={e.id} /> : <div className="ml-icon">{e.kind === 'video' ? <Film size={26} /> : <Music size={26} />}</div>}
                    <span className="ml-name">{e.name}</span>
                    <span className="ml-meta">{e.series ? `${e.series}${e.issue ? ` n°${e.issue}` : ''}` : e.kind === 'video' ? 'Rush' : e.kind === 'audio' ? 'Son' : ''}{e.pageKind ? ` · ${PAGE_KINDS[e.pageKind]?.label ?? ''}` : ''}{mode === 'image' && visual ? ` · ${Math.round(score * 100)}` : ''}</span>
                  </button>
                  {e.kind === 'image' && !e.projects.some((p) => p.id === projectId) && <input type="checkbox" aria-label={`Choisir ${e.name}`} checked={sel.has(e.id)} onChange={(ev) => setSel((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />}
                </li>
              ))}
            </ul>
            {open && (
              <aside className="ml-detail">
                <h3>{open.name}</h3>
                <dl>
                  {open.source && <><dt>Fichier</dt><dd>{open.source}{open.srcIndex != null ? ` · page ${open.srcIndex + 1}${open.srcCount ? ` / ${open.srcCount}` : ''}` : ''}</dd></>}
                  {open.series && <><dt>Série (d’après le nom du fichier)</dt><dd>{open.series}{open.issue ? ` · n°${open.issue}` : ''}{open.year ? ` · ${open.year}` : ''}</dd></>}
                  {open.pageKind && <><dt>Type de page</dt><dd>{PAGE_KINDS[open.pageKind]?.label}</dd></>}
                  {open.chars.length > 0 && <><dt>Personnages cités</dt><dd>{open.chars.join(', ')}</dd></>}
                  {open.text && <><dt>Texte lu dans les bulles</dt><dd className="ml-text">{open.text.slice(0, 400)}</dd></>}
                  <dt>Utilisé dans</dt><dd>{open.projects.map((p) => <button key={p.id} className="link-btn" onClick={() => void openProject(p.id)}><FolderOpen size={12} /> {p.name}</button>)}{open.shots ? ` · ${open.shots} plan${open.shots > 1 ? 's' : ''}` : ''}</dd>
                  {open.size != null && <><dt>Taille</dt><dd>{(open.size / 1e6).toFixed(1)} Mo{open.addedAt ? ` · ajouté le ${new Date(open.addedAt).toLocaleDateString('fr-FR')}` : ''}</dd></>}
                  {dups.some((g) => g.some((x) => x.id === open.id)) && <><dt><Copy size={12} /> Doublons</dt><dd>{dups.find((g) => g.some((x) => x.id === open.id))!.filter((x) => x.id !== open.id).map((x) => `${x.name} (${x.projects.map((p) => p.name).join(', ')})`).join(' · ')}</dd></>}
                </dl>
                {open.kind === 'image' && !open.projects.some((p) => p.id === projectId) && <button className="btn sm primary" onClick={() => void add([open.id])}><Plus size={13} /> Ajouter au projet ouvert</button>}
              </aside>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const thumbs = new Map<string, string>();
function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState(thumbs.get(id) ?? '');
  useEffect(() => {
    if (url) return;
    let live = true;
    void (async () => {
      const { workspace } = await import('../lib/studio');
      const { mediaBlob } = await import('../engine/media');
      const b = (await workspace()?.getMedia(id)) ?? (await mediaBlob(id));
      if (!b || !live) return;
      try {
        const bmp = await createImageBitmap(b, { resizeWidth: 220 });
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close();
        const u = c.toDataURL('image/jpeg', 0.75); thumbs.set(id, u); if (live) setUrl(u);
      } catch { /* not a picture */ }
    })();
    return () => { live = false; };
  }, [id, url]);
  return url ? <img src={url} alt="" loading="lazy" /> : <div className="ml-icon"><Loader2 size={16} className="spin" /></div>;
}
