import React from 'react';
import VODMetadataModal from '../../VODMetadataModal.jsx';

const VODMetadataSettingsForm = ({ active = true }) => (
  <VODMetadataModal opened={active} embedded />
);

export default VODMetadataSettingsForm;
