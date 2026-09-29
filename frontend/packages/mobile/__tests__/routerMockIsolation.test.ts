// The useRouter() mock in jest.setup.js returns ONE object for every render,
// like the real hook. These two tests run in order: the first leaves a call on
// it, the second must not see it. Without the setup's beforeEach that clears
// the router's mocks, the second one fails.
import { useRouter } from 'expo-router';

let firstRouter: ReturnType<typeof useRouter>;

it('el router del mock registra las llamadas de este test', () => {
  firstRouter = useRouter();
  firstRouter.push('/somewhere');
  expect(firstRouter.push).toHaveBeenCalledTimes(1);
});

it('el test siguiente recibe el mismo router, sin las llamadas del anterior', () => {
  const router = useRouter();
  expect(router).toBe(firstRouter);
  expect(router.push).not.toHaveBeenCalled();
});
