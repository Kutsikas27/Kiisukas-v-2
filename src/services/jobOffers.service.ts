import axios from "axios";

export type Job = {
  id: number;
  positionTitle: string;
  employerName: string;
  logoId: string;
  salaryFrom: number | null;
  salaryTo: number | null;
  hourlySalary: boolean;
  positionContent: string;
};

export const getJobOfferings = async () => {
  const response = await axios.get<{ vacancies: Job[] }>(
    `https://cv.ee/api/v1/vacancy-search-service/search?limit=20&offset=0&categories[]=INFORMATION_TECHNOLOGY&sorting=LATEST&fuzzy=true&suitableForRefugees=false&isHourlySalary=false&isQuickApply=false&lang=et`,
  );
  return response.data.vacancies;
};
