// Single CDN entry point. Every other file imports Preact/htm/signals from here, never
// directly from esm.sh, so a version bump or CDN outage only needs a change in one place.
//
// "preact" and "preact/hooks" resolve via the <script type="importmap"> in index.html, not a
// literal esm.sh URL here — @preact/signals (below) is loaded with ?external=preact, which
// only works if it resolves the bare "preact" specifier to the exact same module instance
// this file uses. Pin the version in the import map, not here, if it ever needs to change.
import { h, render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { signal, computed, effect } from 'https://esm.sh/@preact/signals@1.2.1?external=preact';
import htm from 'https://esm.sh/htm@3.1.1';

export const html = htm.bind(h);
export { h, render, useState, useEffect, useRef, signal, computed, effect };
