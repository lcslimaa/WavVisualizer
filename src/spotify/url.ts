/**
 * Parses open.spotify.com track/playlist/album links into a type+id pair,
 * and builds the corresponding spotify: URI used for playback and Web API
 * calls (e.g. spotify:track:abc123).
 */
export type SpotifyLinkType = 'track' | 'playlist' | 'album';

export interface SpotifyLink {
  type: SpotifyLinkType;
  id: string;
}

const LINK_PATTERN = /^\/(track|playlist|album)\/([a-zA-Z0-9]+)/;

/** Returns null if `url` isn't a recognizable open.spotify.com track/playlist/album link. */
export function parseSpotifyUrl(url: string): SpotifyLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'open.spotify.com') return null;

  const match = LINK_PATTERN.exec(parsed.pathname);
  if (!match) return null;

  return { type: match[1] as SpotifyLinkType, id: match[2] };
}

export function isSpotifyUrl(url: string): boolean {
  return parseSpotifyUrl(url) !== null;
}

export function toSpotifyUri(link: SpotifyLink): string {
  return `spotify:${link.type}:${link.id}`;
}
