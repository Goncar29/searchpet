// ============================================================
// SearchPet - Post Tab (Publish wizard: lost pet or stray sighting)
// ============================================================

import { useState } from 'react';
import { View, ScrollView, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { IntentStep } from '../../components/publish/IntentStep';
import { LostPetStep } from '../../components/publish/LostPetStep';
import { StrayFormStep } from '../../components/publish/StrayFormStep';
import { AdoptionFormStep } from '../../components/publish/AdoptionFormStep';
import { LocationStep } from '../../components/publish/LocationStep';
import { InlineAuthStep } from '../../components/publish/InlineAuthStep';
import { CandidatesStep } from '../../components/publish/CandidatesStep';
import { SuccessStep } from '../../components/publish/SuccessStep';
import { usePublishLost, usePublishStrayNative, useCreatePet, useUploadPhotoNative, useStrayCandidates, useCreateReport } from '@shared/hooks';
import { useAuthStore } from '../../store';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { composeBirthDate } from '@shared/utils/petBirthDate';
import type { PetIdentityValue } from '../../components/PetIdentityFields';
import { COLORS, SPACING, FONTS } from '../../constants';
import type { Pet, CreatePetRequest, InitialReportRequest, PetType, StrayCandidate } from '../../../shared/types';

export type PublishStep = 'intent' | 'lost-pet' | 'stray-form' | 'adoption-form' | 'location' | 'auth' | 'candidates' | 'success';
export type PublishIntent = 'lost' | 'stray' | 'adoption';

export interface StrayFormState {
  type: PetType | '';
  breed: string;
  color: string;
  // Sólo el sexo, sin fecha: quien reporta una callejera la encontró en la
  // calle. Ver hideBirthDate en components/PetIdentityFields.
  identity: PetIdentityValue;
  description: string;
  photos: string[]; // local URIs from expo-image-picker
}

export interface AdoptionFormState {
  type: PetType | '';
  breed: string;
  color: string;
  identity: PetIdentityValue;
  description: string;
  city: string;
  photos: string[]; // local URIs from expo-image-picker
}

export interface PublishWizardState {
  intent: PublishIntent | null;
  selectedPet: Pet | null;
  strayForm: StrayFormState;
  adoptionForm: AdoptionFormState;
  location: InitialReportRequest | null;
}

export const initialWizardState: PublishWizardState = {
  intent: null,
  selectedPet: null,
  strayForm: { type: '', breed: '', color: '', description: '', photos: [], identity: { gender: '', birth: { year: '', month: '', day: '' } } },
  adoptionForm: { type: '', breed: '', color: '', description: '', city: '', photos: [], identity: { gender: '', birth: { year: '', month: '', day: '' } } },
  location: null,
};

export default function PostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState<PublishStep>('intent');
  const [wizard, setWizard] = useState<PublishWizardState>(initialWizardState);
  const { isAuthenticated } = useAuthStore();
  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);
  const [failedPhotoIndexes, setFailedPhotoIndexes] = useState<number[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishLost = usePublishLost();
  const publishStray = usePublishStrayNative();
  const createPet = useCreatePet();
  const uploadPhotoNative = useUploadPhotoNative();
  const createReport = useCreateReport();

  // Los callejeros que ya están registrados cerca del punto que la persona
  // acaba de marcar. Sólo consulta parada en el paso: es una lectura protegida
  // y no tiene sentido pedirla mientras todavía llena el formulario.
  const candidatesQuery = useStrayCandidates(
    wizard.location
      ? {
          lat: wizard.location.latitude,
          lng: wizard.location.longitude,
          type: wizard.strayForm.type || undefined,
        }
      : null,
    step === 'candidates',
  );

  const handleIntentSelect = (intent: PublishIntent) => {
    setWizard((prev) => ({ ...prev, intent }));
    if (intent === 'lost' && !isAuthenticated) {
      setStep('auth');
      return;
    }
    if (intent === 'adoption') {
      setStep('adoption-form');
      return;
    }
    setStep(intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  const handleBackFromLocation = () => {
    setPublishError(null);
    setStep(wizard.intent === 'lost' ? 'lost-pet' : 'stray-form');
  };

  // Elegir una de las tres opciones era un camino de ida: ningun paso recibia
  // un onBack, asi que la unica salida era irse a otra pestana. El paso `auth`
  // es el peor caso: a un visitante sin sesion que toca "mi mascota se
  // perdio" lo primero que le aparece es el login.
  const backToIntent = () => {
    setStep('intent');
    setWizard(initialWizardState);
    setPublishError(null);
  };

  // A `auth` se llega por TRES caminos y dos traen un formulario ya
  // completado. Como backToIntent resetea el borrador, mandarlos al selector
  // les borraria lo cargado: peor que el callejon sin salida que esto cierra.
  const resolveBack = (): { onBack: () => void; label: string } | null => {
    // Limpia el error igual que backToIntent: si un intento anterior fallo, el
    // cartel rojo sobrevive al cambio de paso y queda arriba de un formulario
    // que no tiene nada de malo.
    const backTo = (target: PublishStep) => () => {
      setPublishError(null);
      setStep(target);
    };
    if (step === 'lost-pet' || step === 'stray-form' || step === 'adoption-form') {
      return { onBack: backToIntent, label: t('publish:back') };
    }
    // `candidates` tambien necesita salida propia: sus dos botones siguen
    // ADELANTE (publicar igual / es este), asi que sin esto la unica forma de
    // corregir una ubicacion mal puesta seria salirse de la pestana. Vuelve a
    // `location` y no al selector: el borrador esta completo y perderlo seria
    // peor que el callejon.
    if (step === 'candidates') return { onBack: backTo('location'), label: t('publish:backStep') };
    if (step !== 'auth') return null;
    if (wizard.intent === 'lost') return { onBack: backToIntent, label: t('publish:back') };
    if (wizard.intent === 'adoption') return { onBack: backTo('adoption-form'), label: t('publish:backStep') };
    return { onBack: backTo('location'), label: t('publish:backStep') };
  };

  const submitStray = async (location: NonNullable<typeof wizard.location>) => {
    try {
      const result = await publishStray.mutateAsync({
        pet: {
          name: t('publish:strayForm.unnamedPet'),
          type: wizard.strayForm.type as Pet['type'],
          breed: wizard.strayForm.breed.trim() || undefined,
          color: wizard.strayForm.color.trim() || undefined,
          description: wizard.strayForm.description.trim() || undefined,
          gender: wizard.strayForm.identity.gender || undefined,
          // Se manda el par aunque hoy el formulario no lo pida: el dia que se
          // saque hideBirthDate, anda. Leyendo solo `gender` quedarian campos
          // funcionando cuyo valor nunca llega a la API.
          ...(composeBirthDate(wizard.strayForm.identity.birth) ?? {}),
          status: 'stray',
          initial_report: location,
        },
        photoUris: wizard.strayForm.photos,
      });
      setPublishedPet(result.pet);
      setFailedPhotoIndexes(result.failedPhotoIndexes);
      setStep('success');
    } catch (err) {
      setPublishError(getErrorMessage(err, (key) => t(key)));
    }
  };

  // Mirrors submitStray's chain (createPet then sequential, non-blocking photo
  // uploads collecting failedPhotoIndexes) but via the plain useCreatePet +
  // useUploadPhotoNative hooks — there is no chained usePublishAdoptionNative
  // hook, same as the web implementation (PublishWizardPage.submitAdoption).
  // No location/report step for adoption: pets are owner-based.
  const submitAdoption = async () => {
    try {
      const created = await createPet.mutateAsync({
        name: t('publish:strayForm.unnamedPet'),
        type: wizard.adoptionForm.type as Pet['type'],
        breed: wizard.adoptionForm.breed.trim() || undefined,
        color: wizard.adoptionForm.color.trim() || undefined,
        description: wizard.adoptionForm.description.trim() || undefined,
        city: wizard.adoptionForm.city.trim(),
        gender: wizard.adoptionForm.identity.gender || undefined,
        // El par viaja entero o no viaja: mandar uno solo es el 400 del backend.
        ...(composeBirthDate(wizard.adoptionForm.identity.birth) ?? {}),
        status: 'adoption',
      });
      const failed: number[] = [];
      for (let i = 0; i < wizard.adoptionForm.photos.length; i++) {
        try {
          await uploadPhotoNative.mutateAsync({ petId: created.id, uri: wizard.adoptionForm.photos[i] });
        } catch {
          failed.push(i);
        }
      }
      setPublishedPet(created);
      setFailedPhotoIndexes(failed);
      setStep('success');
    } catch (err) {
      setPublishError(getErrorMessage(err, (key) => t(key)));
    }
  };

  const handleAdoptionSubmit = async () => {
    setPublishError(null);
    if (!isAuthenticated) {
      setStep('auth');
      return;
    }
    await submitAdoption();
  };

  const handlePublish = async (location: NonNullable<typeof wizard.location>) => {
    setWizard((prev) => ({ ...prev, location }));
    setPublishError(null);

    if (wizard.intent === 'lost' && wizard.selectedPet) {
      try {
        const pet = await publishLost.mutateAsync({ id: wizard.selectedPet.id, data: location });
        setPublishedPet(pet);
        setFailedPhotoIndexes([]);
        setStep('success');
      } catch (err) {
        setPublishError(getErrorMessage(err, (key) => t(key)));
      }
      return;
    }

    if (!isAuthenticated && wizard.intent === 'stray') {
      setStep('auth');
      return;
    }

    // Ya no publica de una: primero pregunta si el animal no está registrado.
    // El paso va DESPUÉS del login a propósito — reportar sobre una ficha ajena
    // exige cuenta igual, así que con la sesión resuelta el endpoint puede ser
    // protegido y "es este" no rebota contra un 401.
    setStep('candidates');
  };

  // "Ninguno" y "Publicar igual" terminan en lo mismo: el alta que la persona
  // vino a hacer. Un fallo de la consulta NUNCA la bloquea — un 500 no puede
  // impedir que se publique un animal que está en la calle ahora.
  const handleSkipCandidates = () => {
    if (wizard.location) submitStray(wizard.location);
  };

  // "Es este": el avistamiento va sobre la ficha EXISTENTE y no se crea nada
  // nuevo. No hay código de revival — POST /api/reports estampa
  // `last_reported_at` y la mascota vuelve sola al feed, al mapa y al perfil.
  //
  // A diferencia de la web, que deriva a /reports/create, acá se reporta en un
  // solo toque: la ubicación ya está cargada del paso anterior, así que mandar
  // a la persona a marcarla de nuevo sería pedirle dos veces el mismo dato.
  // `status: 'sighting'` porque quien reporta no es el dueño.
  const handleSelectCandidate = (candidate: StrayCandidate) => {
    if (!wizard.location) return;
    Alert.alert(
      t('publish:candidates.confirmTitle'),
      t('publish:candidates.confirmBody', { name: candidate.name }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('publish:candidates.confirmAction'),
          onPress: async () => {
            try {
              await createReport.mutateAsync({
                pet_id: candidate.id,
                status: 'sighting',
                latitude: wizard.location!.latitude,
                longitude: wizard.location!.longitude,
              });
              // Se limpia el borrador ANTES de navegar: el wizard vive en un
              // tab, así que sin esto volver a "Publicar" reabre el formulario
              // con las fotos del animal que se acaba de descartar.
              setStep('intent');
              setWizard(initialWizardState);
              router.push(`/pet/${candidate.id}`);
            } catch (err) {
              setPublishError(getErrorMessage(err, (key) => t(key)));
            }
          },
        },
      ],
    );
  };

  const handleGoToFeed = () => {
    setStep('intent');
    setWizard(initialWizardState);
    setPublishedPet(null);
    setFailedPhotoIndexes([]);
    setPublishError(null);
    router.replace('/(tabs)');
  };

  const back = resolveBack();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View>
        {back && (
          <TouchableOpacity onPress={back.onBack} style={styles.backButton} accessibilityRole="button">
            <Text style={styles.backButtonText}>{`← ${back.label}`}</Text>
          </TouchableOpacity>
        )}
        {step === 'intent' && <IntentStep onSelect={handleIntentSelect} />}
        {step === 'lost-pet' && (
          <LostPetStep
            onSelect={(pet) => {
              setWizard((prev) => ({ ...prev, selectedPet: pet }));
              setStep('location');
            }}
          />
        )}
        {step === 'stray-form' && (
          <StrayFormStep
            value={wizard.strayForm}
            onChange={(strayForm) => setWizard((prev) => ({ ...prev, strayForm }))}
            onNext={() => setStep('location')}
          />
        )}
        {step === 'adoption-form' && (
          <AdoptionFormStep
            value={wizard.adoptionForm}
            onChange={(adoptionForm) => setWizard((prev) => ({ ...prev, adoptionForm }))}
            onSubmit={handleAdoptionSubmit}
            isPending={createPet.isPending}
          />
        )}
        {publishError && <Text style={styles.error}>{publishError}</Text>}
        {step === 'location' && (
          <LocationStep
            value={wizard.location}
            onPublish={handlePublish}
            onBack={handleBackFromLocation}
            isPending={publishLost.isPending || publishStray.isPending}
          />
        )}
        {step === 'auth' && (
          <InlineAuthStep
            onAuthenticated={() => {
              if (wizard.intent === 'lost') {
                setStep('lost-pet');
                return;
              }
              if (wizard.intent === 'adoption') {
                submitAdoption();
                return;
              }
              // Igual que handlePublish: con la sesión recién resuelta, la
              // pregunta por duplicados va antes del alta.
              if (wizard.location) setStep('candidates');
            }}
          />
        )}
        {step === 'candidates' && (
          <CandidatesStep
            query={candidatesQuery}
            onSelect={handleSelectCandidate}
            onSkip={handleSkipCandidates}
            isPublishing={publishStray.isPending || createReport.isPending}
          />
        )}
        {step === 'success' && publishedPet && wizard.intent && (
          <SuccessStep
            pet={publishedPet}
            intent={wizard.intent}
            failedPhotoIndexes={failedPhotoIndexes}
            photoUris={wizard.intent === 'adoption' ? wizard.adoptionForm.photos : wizard.strayForm.photos}
            onRetryComplete={setFailedPhotoIndexes}
            onGoToFeed={handleGoToFeed}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  error: { fontSize: FONTS.sizes.sm, color: COLORS.danger, textAlign: 'center', marginBottom: SPACING.md },
  backButton: { alignSelf: 'flex-start', paddingVertical: SPACING.xs, marginBottom: SPACING.md },
  backButtonText: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: COLORS.textSecondary },
});
