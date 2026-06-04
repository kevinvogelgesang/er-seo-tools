// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UploadChecklist } from './UploadChecklist';

describe('UploadChecklist', () => {
  it('shows a blocking core warning when core exports are missing', () => {
    const { container } = render(<UploadChecklist files={['images_missing_alt_text.csv']} />);
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).toContain('internal');
    expect(text.toLowerCase()).toContain('response codes');
    // SF instruction surfaced for a missing core export
    expect(text.toLowerCase()).toContain('bulk export');
  });

  it('clears the core warning when both core files are present', () => {
    const { container } = render(
      <UploadChecklist files={['internal_all.csv', 'response_codes_all.csv']} />
    );
    expect((container.querySelector('[data-testid="core-missing"]'))).toBeNull();
  });

  it('does NOT show the core-missing block in the initial empty state', () => {
    const { container } = render(<UploadChecklist files={[]} />);
    expect(container.textContent).toBeTruthy();
    expect(container.querySelector('[data-testid="core-missing"]')).toBeNull();
  });
});
