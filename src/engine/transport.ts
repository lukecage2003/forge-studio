import { getState, setUI } from '../store';
import { startPreviewAudio, stopPreviewAudio } from './audio';
import { audioCtx } from './media';
import { segmentsOf, videoDuration } from './timeline';
import { toSource } from './speech';
import { arollPlayer } from './video';

let raf = 0;

export function play() {
  const { project, ui } = getState();
  const dur = videoDuration(project);
  if (dur <= 0) return;
  const t0 = ui.playhead >= dur - 0.02 ? 0 : ui.playhead;
  const T0 = startPreviewAudio(project, t0);
  const ctx = audioCtx();
  const ar = project.aroll;
  const segs = segmentsOf(ar);
  if (ar && segs.length) {
    const m = toSource(segs, t0);
    arollPlayer.start(ar.mediaId, m.src, m.i, segs);
  }
  setUI({ playing: true, playhead: t0, mode: ui.mode === 'cut' ? 'preview' : ui.mode });
  const tick = () => {
    const t = t0 + Math.max(0, ctx.currentTime - T0);
    if (t >= dur) {
      pause();
      setUI({ playhead: dur });
      return;
    }
    if (ar && segs.length) {
      const m = toSource(segs, t);
      arollPlayer.tick(m.src, m.i, segs);
    }
    setUI({ playhead: t });
    raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function pause() {
  cancelAnimationFrame(raf);
  stopPreviewAudio();
  arollPlayer.stop();
  setUI({ playing: false });
}

export const toggle = () => (getState().ui.playing ? pause() : play());

export function seek(t: number) {
  const dur = videoDuration(getState().project);
  const was = getState().ui.playing;
  if (was) pause();
  setUI({ playhead: Math.max(0, Math.min(dur, t)) });
  if (was) play();
}
