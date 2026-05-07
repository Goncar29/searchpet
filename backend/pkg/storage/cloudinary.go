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
// Devuelve la SecureURL del recurso subido, o un error si falla.
func (c *CloudinaryClient) UploadImage(ctx context.Context, file io.Reader, filename string) (string, error) {
	resp, err := c.cld.Upload.Upload(ctx, file, uploader.UploadParams{
		Folder:   "searchpet/pets",
		PublicID: filename,
	})
	if err != nil {
		return "", fmt.Errorf("error subiendo imagen a Cloudinary: %w", err)
	}

	if resp.Error.Message != "" {
		return "", fmt.Errorf("cloudinary rechazó la imagen: %s", resp.Error.Message)
	}

	return resp.SecureURL, nil
}
