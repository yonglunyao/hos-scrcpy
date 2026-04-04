import { describe, it, expect } from 'vitest';
import { getContentType } from '../../src/server';

describe('getContentType', () => {
  it('html', () => expect(getContentType('index.html')).toBe('text/html; charset=utf-8'));
  it('js', () => expect(getContentType('app.js')).toBe('application/javascript'));
  it('css', () => expect(getContentType('style.css')).toBe('text/css'));
  it('json', () => expect(getContentType('data.json')).toBe('application/json'));
  it('png', () => expect(getContentType('image.png')).toBe('image/png'));
  it('jpg', () => expect(getContentType('photo.jpg')).toBe('image/jpeg'));
  it('ico', () => expect(getContentType('favicon.ico')).toBe('image/x-icon'));
  it('unknown extension returns octet-stream', () => {
    expect(getContentType('file.xyz')).toBe('application/octet-stream');
  });
  it('case insensitive', () => {
    expect(getContentType('FILE.HTML')).toBe('text/html; charset=utf-8');
    expect(getContentType('file.JS')).toBe('application/javascript');
  });
  it('no extension returns octet-stream', () => {
    expect(getContentType('Makefile')).toBe('application/octet-stream');
  });
});
