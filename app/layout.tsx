export const metadata = {
  title: "El Infiltrado TMF",
  description: "Juego de integración TMF",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: "Arial, sans-serif",
          backgroundColor: "#f3f4f6",
        }}
      >
        {children}
      </body>
    </html>
  );
}
