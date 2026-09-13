// Single entry point. Every other file imports Preact/htm/signals from here, never directly
// from vendor/, so a version bump only needs a change in one place.
//
// "preact" and "preact/hooks" resolve via the <script type="importmap"> in index.html, not a
// literal path here — vendor/preact-signals.js (below) imports the bare "preact" and
// "preact/hooks" specifiers itself, which only works if the import map resolves them to the
// exact same module instance this file uses. Pin the version in vendor/, not here, if it ever
// needs to change.
import { h, render } from 'preact';
import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'preact/hooks';
import { signal, computed, effect } from '../vendor/preact-signals.js';
import htm from '../vendor/htm.js';

export const html = htm.bind(h);
export { h, render, useState, useEffect, useRef, useLayoutEffect, useMemo, signal, computed, effect };
