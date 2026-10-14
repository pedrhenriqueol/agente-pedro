import type { Preferences } from '../stores/usePreferencesStore';

export const ACCENT_COLORS = {
  mint: { dark: '#10b981', light: '#157453' },
  violet: { dark: '#bca7ff', light: '#7250c1' },
  blue: { dark: '#92c2ff', light: '#296dc1' },
  amber: { dark: '#f5b954', light: '#935c0d' },
  rose: { dark: '#ff99b5', light: '#b33162' },
} as const;

function channels(hex: string): number[] {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string): number {
  return channels(hex).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
}

export function colorContrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

/** Keep a chosen hue while protecting text and controls on the widget's raised surface. */
export function resolveAccentColor(preferences: Pick<Preferences, 'accent' | 'customAccent'>, light: boolean): string {
  if (preferences.accent !== 'custom') return ACCENT_COLORS[preferences.accent][light ? 'light' : 'dark'];
  const chosen = /^#[a-f\d]{6}$/i.test(preferences.customAccent) ? preferences.customAccent : '#10b981';
  const surfaces = light ? ['#e9eee8', '#e6ecf8', '#e1f0e7'] : ['#121620', '#172131', '#142621'];
  const readable = (color: string) => surfaces.every(surface => colorContrast(color, surface) >= 4.5);
  if (readable(chosen)) return chosen;
  const rgb = channels(chosen);
  const end = light ? 0 : 255;
  for (let step = 1; step <= 100; step++) {
    const adjusted = '#' + rgb.map(channel => Math.round(channel + (end - channel) * step / 100).toString(16).padStart(2, '0')).join('');
    if (readable(adjusted)) return adjusted;
  }
  return light ? '#000000' : '#ffffff';
}

export function resolveAccentForeground(accent: string): string {
  return colorContrast(accent, '#05070a') >= colorContrast(accent, '#ffffff') ? '#05070a' : '#ffffff';
}
