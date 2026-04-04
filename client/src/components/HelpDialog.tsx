import {
  Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Button, Typography, List, ListItem, ListItemText,
} from '@mui/material';

export default function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>О программе RWManager</DialogTitle>
      <DialogContent dividers>
        <DialogContentText paragraph>
          Инструмент для автоматического обновления config-profile в панели Remnawave случайными инбаундами по расписанию.
        </DialogContentText>
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Основные возможности:
        </Typography>
        <List dense>
          <ListItem>
            <ListItemText
              primary="Автоматическая ротация"
              secondary="Обновляет инбаунды в выбранном config-profile Remnawave с заданным интервалом."
            />
          </ListItem>
          <ListItem>
            <ListItemText
              primary="Гибкая конфигурация"
              secondary="Поддержка VLESS Reality, VMess, Shadowsocks, Trojan — любая комбинация типов."
            />
          </ListItem>
          <ListItem>
            <ListItemText
              primary="Белый список доменов"
              secondary="SNI-домены для Reality инбаундов выбираются случайно из вашего списка."
            />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Понятно</Button>
      </DialogActions>
    </Dialog>
  );
}
