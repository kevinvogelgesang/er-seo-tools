import { describe, expect, it } from 'vitest';
import { sanitizeRichText } from './sanitize';

describe('sanitizeRichText', () => {
  it('strips <script> tags entirely, including their content', () => {
    expect(sanitizeRichText('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });

  it('strips <img> tags', () => {
    expect(sanitizeRichText('<p>look</p><img src="x.png">')).toBe('<p>look</p>');
  });

  it('strips <a href> tags but keeps inner text', () => {
    expect(sanitizeRichText('<p>go <a href="https://evil.example">here</a></p>')).toBe(
      '<p>go here</p>'
    );
  });

  it('strips onclick= attributes', () => {
    expect(sanitizeRichText('<p onclick="alert(1)">hi</p>')).toBe('<p>hi</p>');
  });

  it('strips style= attributes', () => {
    expect(sanitizeRichText('<p style="color:red">hi</p>')).toBe('<p>hi</p>');
  });

  it('strips <iframe> tags entirely, including their content', () => {
    expect(sanitizeRichText('<p>hi</p><iframe src="https://evil.example"></iframe>')).toBe(
      '<p>hi</p>'
    );
  });

  it('preserves nested <ul><li> lists', () => {
    expect(sanitizeRichText('<ul><li>one</li><li>two</li></ul>')).toBe(
      '<ul><li>one</li><li>two</li></ul>'
    );
  });

  it('preserves nested <ol><li> lists', () => {
    expect(sanitizeRichText('<ol><li>one</li><li>two</li></ol>')).toBe(
      '<ol><li>one</li><li>two</li></ol>'
    );
  });

  it('preserves <strong>, <em>, and <u> inline formatting', () => {
    expect(sanitizeRichText('<p><strong>bold</strong> <em>italic</em> <u>underline</u></p>')).toBe(
      '<p><strong>bold</strong> <em>italic</em> <u>underline</u></p>'
    );
  });

  it('preserves <h2>, <h3>, <p>, and <br>', () => {
    expect(sanitizeRichText('<h2>Title</h2><h3>Sub</h3><p>Body<br>more</p>')).toBe(
      '<h2>Title</h2><h3>Sub</h3><p>Body<br />more</p>'
    );
  });

  it('discards unknown tags but keeps inner text', () => {
    expect(sanitizeRichText('<p>before <marquee>wow</marquee> after</p>')).toBe(
      '<p>before wow after</p>'
    );
  });

  it('drops all attributes even on allowed tags', () => {
    expect(sanitizeRichText('<p class="foo" id="bar" data-x="1">hi</p>')).toBe('<p>hi</p>');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeRichText('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeRichText('   \n\t  ')).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeRichText(null as unknown as string)).toBe('');
    expect(sanitizeRichText(undefined as unknown as string)).toBe('');
    expect(sanitizeRichText(42 as unknown as string)).toBe('');
    expect(sanitizeRichText({} as unknown as string)).toBe('');
  });
});
