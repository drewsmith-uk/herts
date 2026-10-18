import { describe, expect, it } from 'vitest';
import { messagePreview, readingTitle } from '../shared/messagePreview';

describe('plain-text previews', () => {
  it('preserves content while removing Markdown presentation', () => {
    const original = '# A **clear** title\n\nRead [the source](https://example.com) and `file_name`.';
    expect(messagePreview(original)).toBe('A clear title Read the source and file_name.');
    expect(original).toContain('**clear**');
  });
  it('cleans truncated emphasis while preserving code and ordinary punctuation', () => {
    expect(messagePreview('**Give them ongoing responsibilities…')).toBe('Give them ongoing responsibilities…');
    expect(messagePreview('__An unfinished preview')).toBe('An unfinished preview');
    expect(messagePreview('Use `**literal**` and my_file_name')).toBe('Use **literal** and my_file_name');
  });
  it('summarizes transport attachments without leaking paths', () => {
    expect(messagePreview('@file:/tmp/private.txt MEDIA:"/tmp/image one.png"')).toBe('2 attachments');
    expect(messagePreview('', 1)).toBe('1 attachment');
    expect(messagePreview('Review @image:/tmp/photo.jpg')).toBe('Review');
  });
  it('does not remove ordinary underscores or invent article titles', () => {
    expect(messagePreview('my_file_name and 2 * 3')).toBe('my_file_name and 2 * 3');
    expect(readingTitle('', 'https://example.com/project/report')).toBe('example.com/project/report');
    expect(readingTitle('My title', 'https://example.com')).toBe('My title');
  });
});
