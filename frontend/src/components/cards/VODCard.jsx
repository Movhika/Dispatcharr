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
import { Calendar, Clock, Play, Star } from 'lucide-react';
import React from 'react';
import classes from '../VODLayout.module.css';
import {
  formatDuration,
  getSeasonLabel,
  vodLogoSrc,
} from '../../utils/cards/VODCardUtils.js';

const VODCard = ({ vod, onClick }) => {
  const isEpisode = vod.type === 'episode';
  const posterSrc = vodLogoSrc(vod.logo);

  const getDisplayTitle = () => {
    if (isEpisode && vod.series) {
      return (
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            {vod.series.name}
          </Text>
          <Text fw={500} className={classes.cardTitle}>
            {getSeasonLabel(vod)} - {vod.name}
          </Text>
        </Stack>
      );
    }
    return (
      <Text fw={500} className={classes.cardTitle}>
        {vod.name}
      </Text>
    );
  };

  const handleCardClick = () => {
    onClick(vod);
  };

  return (
    <Card
      shadow="sm"
      padding="md"
      radius="md"
      withBorder
      className={classes.card}
      role="button"
      tabIndex={0}
      aria-label={`Preview ${vod.name}`}
      aria-haspopup="dialog"
      onClick={handleCardClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleCardClick();
        }
      }}
    >
      <CardSection>
        <Box pos="relative" h={300}>
          {posterSrc ? (
            <Image src={posterSrc} height={300} alt={vod.name} fit="contain" />
          ) : (
            <Box className={classes.placeholder} h={300} display="flex">
              <Play size={48} aria-hidden="true" />
            </Box>
          )}

          <Badge
            pos="absolute"
            bottom={8}
            left={8}
            color={isEpisode ? 'blue' : 'green'}
          >
            {isEpisode ? 'Episode' : 'Movie'}
          </Badge>
        </Box>
      </CardSection>

      <Stack gap={8} mt="md">
        {getDisplayTitle()}

        <Group gap={16}>
          {vod.year && (
            <Group gap={4}>
              <Calendar size={14} color="#666" />
              <Text size="xs" c="dimmed">
                {vod.year}
              </Text>
            </Group>
          )}

          {vod.duration && (
            <Group gap={4}>
              <Clock size={14} color="#666" />
              <Text size="xs" c="dimmed">
                {formatDuration(vod.duration_secs)}
              </Text>
            </Group>
          )}

          {vod.rating && (
            <Group gap={4}>
              <Star size={14} color="#666" />
              <Text size="xs" c="dimmed">
                {vod.rating}
              </Text>
            </Group>
          )}
        </Group>

        {vod.genre && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {vod.genre}
          </Text>
        )}
      </Stack>
    </Card>
  );
};

export default VODCard;
