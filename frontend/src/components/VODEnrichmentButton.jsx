import React from 'react';
import { Button } from '@mantine/core';
import { Pencil } from 'lucide-react';

const VODEnrichmentButton = ({ onClick }) => (
  <Button
    size="xs"
    variant="default"
    leftSection={<Pencil size={15} />}
    onClick={onClick}
  >
    Edit metadata
  </Button>
);

export default VODEnrichmentButton;
