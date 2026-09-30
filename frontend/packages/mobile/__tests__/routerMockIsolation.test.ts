// The useRouter() mock in jest.setup.js returns ONE object for every render,
// like the real hook. The first test leaves a call and an implementation on
// it; the second must see neither. Without the setup's beforeEach that resets
// the router's mocks, the second one fails. Run alone, the second one still
// passes: nothing was left on the router, which is the state it asserts.
import { useRouter } from 'expo-router';

it('el router del mock registra las llamadas de este test', () => {
  const router = useRouter();
  (router.push as jest.Mock).mockImplementation(() => 'leaked');
  router.push('/somewhere');
  expect(router.push).toHaveBeenCalledTimes(1);
});

it('el test siguiente recibe el mismo router, sin lo que dejó el anterior', () => {
  expect(useRouter()).toBe(useRouter());
  const router = useRouter();
  expect(router.push).not.toHaveBeenCalled();
  expect(router.push('/x')).toBeUndefined();
});
