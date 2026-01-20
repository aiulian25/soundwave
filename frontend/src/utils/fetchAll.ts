import { audioAPI, playlistAPI, channelAPI } from '../api/client';

const PAGE_SIZE = 50;

/**
 * Fetch all pages of audio data
 */
export async function fetchAllAudio(params: Record<string, any> = {}): Promise<any[]> {
  let allData: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await audioAPI.list({ ...params, page });
    const data = response.data?.data || response.data || [];

    if (Array.isArray(data) && data.length > 0) {
      allData = [...allData, ...data];
      page++;
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  return allData;
}

/**
 * Fetch all playlists (handles both paginated and non-paginated responses)
 */
export async function fetchAllPlaylists(params: Record<string, any> = {}): Promise<any[]> {
  const response = await playlistAPI.list(params);
  
  // Handle different response formats
  if (Array.isArray(response.data)) {
    return response.data;
  }
  
  // Paginated response
  const data = response.data?.data || response.data?.results || [];
  
  // If paginated, fetch all pages
  if (response.data?.paginate || response.data?.next) {
    let allData = Array.isArray(data) ? [...data] : [];
    let page = 2;
    let hasMore = data.length >= PAGE_SIZE;
    
    while (hasMore) {
      const nextResponse = await playlistAPI.list({ ...params, page });
      const nextData = nextResponse.data?.data || nextResponse.data?.results || nextResponse.data || [];
      
      if (Array.isArray(nextData) && nextData.length > 0) {
        allData = [...allData, ...nextData];
        page++;
        if (nextData.length < PAGE_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    return allData;
  }
  
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch all channels (handles both paginated and non-paginated responses)
 */
export async function fetchAllChannels(params: Record<string, any> = {}): Promise<any[]> {
  const response = await channelAPI.list(params);
  
  // Handle different response formats
  if (Array.isArray(response.data)) {
    return response.data;
  }
  
  // Paginated response
  const data = response.data?.data || response.data?.results || [];
  
  // If paginated, fetch all pages
  if (response.data?.paginate || response.data?.next) {
    let allData = Array.isArray(data) ? [...data] : [];
    let page = 2;
    let hasMore = data.length >= PAGE_SIZE;
    
    while (hasMore) {
      const nextResponse = await channelAPI.list({ ...params, page });
      const nextData = nextResponse.data?.data || nextResponse.data?.results || nextResponse.data || [];
      
      if (Array.isArray(nextData) && nextData.length > 0) {
        allData = [...allData, ...nextData];
        page++;
        if (nextData.length < PAGE_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    return allData;
  }
  
  return Array.isArray(data) ? data : [];
}
