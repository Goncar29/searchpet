import React from 'react';
import { render } from '@testing-library/react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../components/Icon';
import { ICON_PATHS } from '../../shared/icons/paths';
import { COLORS } from '../constants';

describe('Icon (mobile)', () => {
  it('is hidden from accessibility when there is no label', () => {
    const { getByTestId } = render(<Icon name="home" testID="i" />);
    // Hidden elements are skipped by default queries; that is the point.
    expect(() => getByTestId('i')).toThrow();
    const svg = getByTestId('i', { includeHiddenElements: true });
    expect(svg.props.accessibilityElementsHidden).toBe(true);
    expect(svg.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(svg.props.accessible).toBe(false);
    expect(svg.props.accessibilityLabel).toBeUndefined();
  });

  it('is exposed as an image when labelled', () => {
    const { getByTestId } = render(<Icon name="home" testID="i" accessibilityLabel="Inicio" />);
    const svg = getByTestId('i');
    expect(svg.props.accessible).toBe(true);
    expect(svg.props.accessibilityRole).toBe('image');
    expect(svg.props.accessibilityLabel).toBe('Inicio');
    expect(svg.props.accessibilityElementsHidden).toBeUndefined();
  });

  it('sizes the svg (default 24)', () => {
    const { UNSAFE_getByType, rerender } = render(<Icon name="home" />);
    expect(UNSAFE_getByType(Svg).props.width).toBe(24);
    expect(UNSAFE_getByType(Svg).props.height).toBe(24);
    expect(UNSAFE_getByType(Svg).props.viewBox).toBe('0 0 24 24');
    rerender(<Icon name="home" size={40} />);
    expect(UNSAFE_getByType(Svg).props.width).toBe(40);
    expect(UNSAFE_getByType(Svg).props.height).toBe(40);
  });

  // Without a color react-native-svg paints black, which vanishes on dark
  // surfaces; the default is the app's primary text color instead.
  it('defaults the fill to the primary text color, not black', () => {
    const { UNSAFE_getByType } = render(<Icon name="search" />);
    expect(UNSAFE_getByType(Path).props.fill).toBe(COLORS.textPrimary);
  });

  it('draws the registry path in the given color', () => {
    const { UNSAFE_getByType } = render(<Icon name="search" color="#C24E1A" />);
    const path = UNSAFE_getByType(Path);
    expect(path.props.d).toBe(ICON_PATHS.search);
    expect(path.props.fill).toBe('#C24E1A');
  });
});
