// ============================================================
// SearchPet - Create Success Story Page (Web)
// ============================================================

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCreateStory } from '@shared/hooks';

export function CreateStoryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const petId = searchParams.get('petId') ?? '';

  const createStory = useCreateStory();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!body.trim()) {
      setBodyError('La historia es obligatoria');
      return;
    }
    setBodyError('');

    createStory.mutate(
      {
        pet_id: petId,
        title: title.trim() || undefined,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          navigate(-1);
        },
        onError: () => {
          // error shown inline via createStory.isError
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <span className="text-5xl block mb-3">🎉</span>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
            Compartí la historia
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Contanos cómo fue el reencuentro para inspirar a otros
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Historia (obligatoria) */}
          <div>
            <label
              htmlFor="body"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Historia <span className="text-red-500">*</span>
            </label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                if (e.target.value.trim()) setBodyError('');
              }}
              rows={6}
              placeholder="¿Cómo fue el reencuentro? ¿Quién ayudó? ¿Cuánto tiempo pasó?"
              className={`w-full rounded-lg border ${
                bodyError
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 dark:border-gray-600'
              } bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none`}
            />
            {bodyError && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{bodyError}</p>
            )}
          </div>

          {/* Título (opcional) */}
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Título <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: ¡Luna volvió a casa después de 3 semanas!"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Error de API */}
          {createStory.isError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3">
              <p className="text-sm text-red-600 dark:text-red-400">
                {(createStory.error as Error)?.message ||
                  'No se pudo publicar la historia. Intentá de nuevo.'}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={createStory.isPending}
            className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
          >
            {createStory.isPending ? 'Publicando...' : 'Publicar historia'}
          </button>

          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={createStory.isPending}
            className="w-full py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}
