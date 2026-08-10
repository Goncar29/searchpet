import { render, fireEvent } from '@testing-library/react-native';
import { PetIdentityFields, type PetIdentityValue } from '../components/PetIdentityFields';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const vacio: PetIdentityValue = { gender: '', birth: { year: '', month: '', day: '' } };

describe('PetIdentityFields (mobile)', () => {
  it('elegir un sexo lo reporta hacia arriba', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(<PetIdentityFields value={vacio} onChange={onChange} />);

    fireEvent.press(getByLabelText('pets:genders.female'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gender: 'female' }));
  });

  // En web el <select> tiene una opcion "—" para volver a vacio. Acá no hay
  // ninguna: sin esto, tocar "Macho" sin querer no tendria vuelta atras.
  it('tocar el sexo ya elegido lo DESELECCIONA', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <PetIdentityFields value={{ ...vacio, gender: 'male' }} onChange={onChange} />
    );

    fireEvent.press(getByLabelText('pets:genders.male'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gender: '' }));
  });

  // Quien reporta una callejera la encontro en la calle: el sexo lo puede VER,
  // la fecha de nacimiento no la puede saber. Pedirsela lo invita a inventar.
  it('con hideBirthDate pide el sexo y NO la fecha', () => {
    const { getByLabelText, queryByTestId } = render(
      <PetIdentityFields value={vacio} onChange={jest.fn()} hideBirthDate />
    );

    expect(getByLabelText('pets:genders.male')).toBeTruthy();
    expect(queryByTestId('birth-year-input')).toBeNull();
    expect(queryByTestId('birth-month-input')).toBeNull();
  });

  it('sin hideBirthDate ofrece los tres campos de fecha', () => {
    const { getByTestId } = render(<PetIdentityFields value={vacio} onChange={jest.fn()} />);

    expect(getByTestId('birth-year-input')).toBeTruthy();
    expect(getByTestId('birth-month-input')).toBeTruthy();
    expect(getByTestId('birth-day-input')).toBeTruthy();
  });

  // El teclado numerico de Android igual deja PEGAR texto. Una letra hace que
  // composeBirthDate descarte la fecha entera en silencio, asi que se filtra
  // en la entrada en vez de perder el dato despues.
  it('descarta lo que no sea digito y respeta el largo', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<PetIdentityFields value={vacio} onChange={onChange} />);

    fireEvent.changeText(getByTestId('birth-year-input'), '20a22XYZ');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ birth: expect.objectContaining({ year: '2022' }) })
    );
  });

  // React Native mapea `checked` a radio/checkbox y `selected` a roles tipo
  // pestania. Con `selected`, los lectores de pantalla leen las tres opciones
  // igual y no dicen cual esta activa — justo el dato que hace falta, porque la
  // unica forma de limpiar el valor es volver a tocar la que ya lo esta.
  it('anuncia cual sexo esta elegido con `checked`, no con `selected`', () => {
    const { getByLabelText } = render(
      <PetIdentityFields value={{ ...vacio, gender: 'female' }} onChange={jest.fn()} />
    );

    expect(getByLabelText('pets:genders.female').props.accessibilityState.checked).toBe(true);
    expect(getByLabelText('pets:genders.male').props.accessibilityState.checked).toBe(false);
  });

  // Sin anio no hay fecha posible, y "el 9 de algun mes" no existe en el modelo.
  it('vaciar el anio vacia mes y dia', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <PetIdentityFields
        value={{ gender: '', birth: { year: '2022', month: '3', day: '9' } }}
        onChange={onChange}
      />
    );

    fireEvent.changeText(getByTestId('birth-year-input'), '');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ birth: { year: '', month: '', day: '' } })
    );
  });
});
