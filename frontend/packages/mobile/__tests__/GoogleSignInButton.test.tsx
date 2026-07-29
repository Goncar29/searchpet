import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

beforeEach(() => {
  jest.clearAllMocks();
});

test('hands the id token to onToken', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token', user: { email: 'c@example.com' } },
  });
  const onToken = jest.fn();

  const { getByRole } = render(<GoogleSignInButton clientId={CLIENT_ID} onToken={onToken} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(onToken).toHaveBeenCalledWith('google-id-token'));
  expect(GoogleSignin.configure).toHaveBeenCalledWith({ webClientId: CLIENT_ID });
});

test('renders nothing when the client id is not configured', () => {
  const { queryByRole } = render(<GoogleSignInButton clientId="" onToken={jest.fn()} />);
  expect(queryByRole('button')).toBeNull();
});

// Cancelar es una decisión del usuario, no una falla. En v16 llega como un valor
// de retorno, no como excepción: tratarlo como error mostraría una alerta absurda.
test('cancelling is silent', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled', data: null });
  const onToken = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton clientId={CLIENT_ID} onToken={onToken} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(GoogleSignin.signIn).toHaveBeenCalled());
  expect(onToken).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

// Un success sin token no se puede mandar al backend: sería un 401 confuso.
test('a success response with a null idToken is treated as a failure', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
    type: 'success',
    data: { idToken: null, user: { email: 'c@example.com' } },
  });
  const onToken = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton clientId={CLIENT_ID} onToken={onToken} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(onToken).not.toHaveBeenCalled();
});

test('reports missing Play services', async () => {
  const err: Error & { code?: string } = new Error('no play services');
  err.code = statusCodes.PLAY_SERVICES_NOT_AVAILABLE;
  (GoogleSignin.signIn as jest.Mock).mockRejectedValue(err);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton clientId={CLIENT_ID} onToken={jest.fn()} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(alert).toHaveBeenCalled());
});

// DEVELOPER_ERROR no está en statusCodes, llega como un code suelto. Debe caer en
// la rama genérica y avisar, no pasar de largo en silencio.
test('an unknown error code still tells the user something went wrong', async () => {
  const err: Error & { code?: string } = new Error('developer error');
  err.code = 'DEVELOPER_ERROR';
  (GoogleSignin.signIn as jest.Mock).mockRejectedValue(err);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  const { getByRole } = render(<GoogleSignInButton clientId={CLIENT_ID} onToken={jest.fn()} />);
  fireEvent.press(getByRole('button'));

  await waitFor(() => expect(alert).toHaveBeenCalled());
});
