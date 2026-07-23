import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PhotoBanner } from './PhotoBanner';

function setImageNaturalSize(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
}

function setContainerWidth(container: HTMLElement, width: number) {
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
}

describe('PhotoBanner', () => {
  it('renders the photo with object-fit contain before the image loads', () => {
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

  // html2canvas does not honor object-fit, so on load the component must
  // switch to explicit pixel dimensions computed with "contain" math.
  it('sets explicit contained dimensions for a portrait photo on load', () => {
    const { container } = render(
      <PhotoBanner photoUrl="https://img.test/dog.jpg" petName="Firulais" heightPx={400} />
    );

    const wrapper = container.firstElementChild as HTMLElement;
    setContainerWidth(wrapper, 600);

    const img = container.querySelector('img') as HTMLImageElement;
    setImageNaturalSize(img, 300, 600); // portrait 1:2
    fireEvent.load(img);

    // Height is the limit: 400px tall → width = 300 * (400/600) = 200px
    expect(img.style.width).toBe('200px');
    expect(img.style.height).toBe('400px');
  });

  it('sets explicit contained dimensions for a landscape photo on load', () => {
    const { container } = render(
      <PhotoBanner photoUrl="https://img.test/dog.jpg" petName="Firulais" heightPx={400} />
    );

    const wrapper = container.firstElementChild as HTMLElement;
    setContainerWidth(wrapper, 600);

    const img = container.querySelector('img') as HTMLImageElement;
    setImageNaturalSize(img, 1200, 600); // landscape 2:1
    fireEvent.load(img);

    // Width is the limit: 600px wide → height = 600 * (600/1200) = 300px
    expect(img.style.width).toBe('600px');
    expect(img.style.height).toBe('300px');
  });

  it('keeps the contain fallback when natural dimensions are unavailable', () => {
    const { container } = render(
      <PhotoBanner photoUrl="https://img.test/dog.jpg" petName="Firulais" heightPx={400} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    // jsdom default: naturalWidth/naturalHeight are 0
    fireEvent.load(img);

    expect(img.style.objectFit).toBe('contain');
    expect(img.style.width).toBe('100%');
  });

  it('shows a paw placeholder when there is no photo', () => {
    const { container, getByLabelText } = render(
      <PhotoBanner petName="Firulais" heightPx={400} />
    );

    expect(getByLabelText('SearchPet')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
