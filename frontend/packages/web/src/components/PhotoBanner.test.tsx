import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PhotoBanner } from './PhotoBanner';

describe('PhotoBanner', () => {
  it('renders the photo filling the banner with object-fit contain', () => {
    const { container } = render(
      <PhotoBanner photoUrl="https://img.test/dog.jpg" petName="Firulais" heightPx={400} />
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe('400px');

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('https://img.test/dog.jpg');
    expect(img.alt).toBe('Firulais');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
  });

  it('shows a 🐾 placeholder when there is no photo', () => {
    const { container, getByText } = render(
      <PhotoBanner petName="Firulais" heightPx={400} />
    );

    expect(getByText('🐾')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
