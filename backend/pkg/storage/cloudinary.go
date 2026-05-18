package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/cloudinary/cloudinary-go/v2"
	"github.com/cloudinary/cloudinary-go/v2/api/uploader"
)

// CloudinaryClient es el wrapper sobre el SDK de Cloudinary.
// Encapsula la lógica de upload para que el resto del sistema no sepa nada de Cloudinary.
type CloudinaryClient struct {
	cld *cloudinary.Cloudinary
}

// NewCloudinaryClient crea un cliente Cloudinary usando las tres credenciales separadas.
// Usa NewFromParams en lugar de NewFromURL — diseño explícito para credenciales separadas.
func NewCloudinaryClient(cloudName, apiKey, apiSecret string) (*CloudinaryClient, error) {
	cld, err := cloudinary.NewFromParams(cloudName, apiKey, apiSecret)
	if err != nil {
		return nil, fmt.Errorf("error inicializando Cloudinary: %w", err)
	}
	return &CloudinaryClient{cld: cld}, nil
}

// UploadImage sube un archivo a Cloudinary en la carpeta searchpet/pets.
// Devuelve (secureURL, publicID, error). Ambas cadenas están vacías en caso de error.
func (c *CloudinaryClient) UploadImage(ctx context.Context, file io.Reader, filename string) (string, string, error) {
	resp, err := c.cld.Upload.Upload(ctx, file, uploader.UploadParams{
		Folder:         "searchpet/pets",
		PublicID:       filename,
		Format:         "webp",
		Transformation: "w_1200,c_limit,q_80",
	})
	if err != nil {
		return "", "", fmt.Errorf("error subiendo imagen a Cloudinary: %w", err)
	}

	if resp.Error.Message != "" {
		return "", "", fmt.Errorf("cloudinary rechazó la imagen: %s", resp.Error.Message)
	}

	return resp.SecureURL, resp.PublicID, nil
}

// Delete elimina un asset de Cloudinary por su public_id.
// Retorna error si la API responde con un error; "not found" se trata como no-error.
func (c *CloudinaryClient) Delete(ctx context.Context, publicID string) error {
	resp, err := c.cld.Upload.Destroy(ctx, uploader.DestroyParams{PublicID: publicID})
	if err != nil {
		return fmt.Errorf("error eliminando imagen de Cloudinary (publicID=%s): %w", publicID, err)
	}
	if resp.Error.Message != "" {
		return fmt.Errorf("cloudinary rechazó el delete (publicID=%s): %s", publicID, resp.Error.Message)
	}
	return nil
}
