import { Box, Container, Grid, IconButton, Stack } from '@mui/material';
import { YouTube, Telegram } from '@mui/icons-material';

interface FooterProps {
  isMobile?: boolean;
}

export default function Footer({ isMobile }: FooterProps) {
  return (
    <Box
      component="footer"
      sx={{
        py: 3,
        px: 2,
        mt: 'auto',
        backgroundColor: (theme) =>
          theme.palette.mode === 'light'
            ? theme.palette.grey[200]
            : theme.palette.grey[900],
      }}
    >
      <Container maxWidth={false}>
        <Grid container spacing={4} justifyContent="space-between" alignItems="center">

          <Grid size={{ xs: 12, sm: 4 }} />

          <Grid size={{ xs: 12, sm: 4 }} />

          <Grid size={{ xs: 12, sm: 4 }} sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
            <Stack direction="row" spacing={1} justifyContent={{ xs: 'center', sm: 'flex-end' }}>

              <IconButton
                component="a"
                href="https://youtube.com/@denpiligrim"
                target="_blank"
                aria-label="YouTube"
                color="inherit"
              >
                <YouTube />
              </IconButton>

              <IconButton
                component="a"
                href="https://t.me/denpiligrim_web"
                target="_blank"
                aria-label="Telegram"
                color="inherit"
              >
                <Telegram />
              </IconButton>

            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}