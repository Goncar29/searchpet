package service

import "testing"

func TestCloudinaryDownscaleURL(t *testing.T) {
	const transform = "c_limit,w_512,h_512,q_auto"

	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "prod webp url gets transform before version",
			in:   "https://res.cloudinary.com/dd0yz5yxb/image/upload/v1782838354/searchpet/pets/abc/gatos_123.webp",
			want: "https://res.cloudinary.com/dd0yz5yxb/image/upload/" + transform + "/v1782838354/searchpet/pets/abc/gatos_123.webp",
		},
		{
			name: "jpg url gets transform",
			in:   "https://res.cloudinary.com/demo/image/upload/v1/folder/cat.jpg",
			want: "https://res.cloudinary.com/demo/image/upload/" + transform + "/v1/folder/cat.jpg",
		},
		{
			name: "non-cloudinary url unchanged",
			in:   "https://cdn.example.com/photo.jpg",
			want: "https://cdn.example.com/photo.jpg",
		},
		{
			name: "already-transformed url left alone (next segment is not a version)",
			in:   "https://res.cloudinary.com/demo/image/upload/w_300/v1/cat.jpg",
			want: "https://res.cloudinary.com/demo/image/upload/w_300/v1/cat.jpg",
		},
		{
			name: "no version segment left alone",
			in:   "https://res.cloudinary.com/demo/image/upload/cat.jpg",
			want: "https://res.cloudinary.com/demo/image/upload/cat.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cloudinaryDownscaleURL(tt.in); got != tt.want {
				t.Errorf("cloudinaryDownscaleURL(%q)\n got = %q\nwant = %q", tt.in, got, tt.want)
			}
		})
	}
}
