import {
  Badge,
  Box,
  Card,
  CardSection,
  Group,
  Image,
  Stack,
  Text,
} from '@mantine/core';
import { Calendar, Play, Star } from 'lucide-react';
import React from 'react';
import classes from '../VODLayout.module.css';
import { vodLogoSrc } from '../../utils/cards/VODCardUtils.js';

const SeriesCard = ({ series, onClick }) => {
  const posterSrc = vodLogoSrc(series.logo);
  return (
    <Card
      shadow="sm"
      padding="md"
      radius="md"
      withBorder
      className={classes.card}
      role="button"
      tabIndex={0}
      aria-label={`Preview ${series.name}`}
      aria-haspopup="dialog"
      onClick={() => onClick(series)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(series);
        }
      }}
    >
      <CardSection>
        <Box pos="relative" h={300}>
          {posterSrc ? (
            <Image
              src={posterSrc}
              height={300}
              alt={series.name}
              fit="contain"
            />
          ) : (
            <Box className={classes.placeholder} h={300} display="flex">
              <Play size={48} aria-hidden="true" />
            </Box>
          )}
          {/* Add Series badge in the same position as Movie badge */}
          <Badge pos="absolute" bottom={8} left={8} color="purple">
            Series
          </Badge>
        </Box>
      </CardSection>

      <Stack gap={8} mt="md">
        <Text fw={500} className={classes.cardTitle}>
          {series.name}
        </Text>

        <Group gap={16}>
          {series.year && (
            <Group gap={4}>
              <Calendar size={14} color="#666" />
              <Text size="xs" c="dimmed">
                {series.year}
              </Text>
            </Group>
          )}
          {series.rating && (
            <Group gap={4}>
              <Star size={14} color="#666" />
              <Text size="xs" c="dimmed">
                {series.rating}
              </Text>
            </Group>
          )}
        </Group>

        {series.genre && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {series.genre}
          </Text>
        )}
      </Stack>
    </Card>
  );
};

export default SeriesCard;
