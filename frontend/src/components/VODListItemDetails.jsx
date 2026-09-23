import React from 'react';
import SeriesModal from './SeriesModal.jsx';
import VODModal from './VODModal.jsx';

const VODListItemDetails = ({ item, onClose }) => {
  if (!item?.is_available || !item.canonical_id) return null;

  const sharedProps = {
    opened: true,
    initialRelationId: item.relation_ids?.[0] || null,
    listSourceScope: {
      includeAllSources: item.include_all_sources,
      relationIds: item.relation_ids || [],
    },
    onClose,
  };
  const content = {
    id: item.canonical_id,
    name: item.display_title,
    year: item.display_year,
    type: item.content_type,
  };

  return item.content_type === 'series' ? (
    <SeriesModal {...sharedProps} series={content} />
  ) : (
    <VODModal {...sharedProps} vod={content} />
  );
};

export default VODListItemDetails;
